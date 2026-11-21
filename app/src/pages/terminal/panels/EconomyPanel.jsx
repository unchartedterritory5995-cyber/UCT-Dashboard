// ECON: the economy board. The official numbers that move markets, theme by theme (inflation, jobs,
// growth and spending, housing, rates), each with its latest print, the one before, the change, the
// period it covers, the day it came out and the next release from the release calendar; the
// releases due in the next seven days at the top; every agency's credit line at the foot. `ECON`.
//
// ONE read, `GET /api/econ/latest` (api/routers/econ.py: the econ routes' own flag and gate). It
// answers from what the econ service has already published; it never asks an agency on the
// request. Asked again every two minutes (the server's cache lifetime); SWR skips ticks while the
// app is hidden. The pure half is economyModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a series not held, a period the agency published no figure for and
// a change without two prints are words.
// ⛔ THE ECONOMIC DATA SWITCHED OFF FOR THIS SERVER (404) IS SAID, never drawn as an empty board.
// ⛔ A NAME OPENS THE SERIES ON THE CHART the way an economic symbol already opens there (/charts with
// `ECON:<symbol>`): the shell's linked panels carry stocks, not economic series.
//
// WIDTH. One four-column table (merged two- and three-line cells), so the columns line up from theme
// to theme; in a snug or narrow panel the cells wrap between words and nothing folds away.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { useMarketRead } from './marketRead'
import {
  ECON_CODE, ECON_LATEST_URL, ECON_POLL_MS, ECON_SOURCE, STRIP_DAYS, econFailure, economyRead, etToday, noFigureText,
} from './economyModel'
import styles from './marketPanels.module.css'
import own from './economyPanel.module.css'

export { ECON_CODE, ECON_LATEST_URL, ECON_POLL_MS, ECON_SOURCE } from './economyModel'

function Ahead({ ahead }) {
  return (
    <section className={own.section} aria-label={`Releases in the next ${STRIP_DAYS} days`} data-testid="terminal-econ-ahead">
      <h3 className={own.title}>{`Releases in the next ${STRIP_DAYS} days`}</h3>
      {ahead.length ? (
        <ul className={own.strip} data-testid="terminal-econ-ahead-list">
          {ahead.map((g) => (
            <li key={`${g.date}-${g.time || ''}`} className={own.stripItem} data-testid="terminal-econ-ahead-item">
              <span className={own.when}>{g.when}</span>
              <span className="sr-only">: </span>
              <span className={own.what}>{g.labels.join(', ')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted} data-testid="terminal-econ-ahead-none">
          {`No release of these series is held for the next ${STRIP_DAYS} days.`}
        </p>
      )}
      <p className={styles.muted}>From the release calendar the server holds. The daily series (the rates and the dollar index) are not listed.</p>
    </section>
  )
}

function NameCell({ r }) {
  return (
    <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
      {r.state === 'not_found'
        ? <span className={own.value}>{r.label}</span>
        : <Link className={own.name} to={r.chartHref} title={`Open ${r.label} on the chart`} data-testid={`terminal-econ-open-${r.key}`}>{r.label}</Link>}
      {r.measure ? <span className={own.sub} data-testid={`terminal-econ-measure-${r.key}`}>{r.measure}{r.derived ? ', UCT calculation' : ''}</span> : null}
    </td>
  )
}

function Row({ r }) {
  if (r.state !== 'ok') {
    return (
      <tr data-testid={`terminal-econ-row-${r.key}`} data-state={r.state}>
        <NameCell r={r} />
        <td colSpan={3} className={`${own.textCol} ${styles.phoneWrap} ${styles.snugWrap}`}>
          <span className={own.sub} data-testid={`terminal-econ-none-${r.key}`}>{r.words}</span>
          {r.next ? <span className={own.sub}>{r.next.state === 'ok' ? `Next ${r.next.text}` : r.next.text}</span> : null}
        </td>
      </tr>
    )
  }
  const { latest, prior, change, alt, next, note } = r
  return (
    <tr data-testid={`terminal-econ-row-${r.key}`} data-state="ok">
      <NameCell r={r} />
      <td className={`${styles.phoneWrap} ${styles.snugWrap}`} data-testid={`terminal-econ-latest-${r.key}`}>
        <span className={own.value}>{latest.text ?? noFigureText(latest.period)}</span>
        <span className={own.sub}>{latest.period}</span>
        {alt ? <span className={own.sub} data-testid={`terminal-econ-alt-${r.key}`}>{`${alt.label} ${alt.text}`.trim()}{alt.samePeriod ? '' : ` (${alt.period})`}</span> : null}
      </td>
      <td className={`${styles.phoneWrap} ${styles.snugWrap}`} data-testid={`terminal-econ-prior-${r.key}`} title={prior?.period ? `The print before: ${prior.period}` : undefined}>
        <span className={own.value}>{prior ? (prior.text ?? noFigureText(prior.period)) : 'No earlier print held'}</span>
        {change ? <span className={own.sub} data-testid={`terminal-econ-change-${r.key}`}><span className="sr-only">change </span>{change.text}</span> : null}
      </td>
      <td className={`${own.textCol} ${styles.phoneWrap} ${styles.snugWrap}`} data-testid={`terminal-econ-next-${r.key}`}>
        <span className={own.value}>{latest.released ? `Released ${latest.released}` : 'Release day not held'}</span>
        <span className={own.sub}>{next.state === 'ok' ? `Next ${next.text}` : next.text}</span>
        {note ? <span className={own.sub} data-testid={`terminal-econ-note-${r.key}`}>{note}</span> : null}
      </td>
    </tr>
  )
}

function Board({ themes }) {
  return (
    <div className={styles.tableBox}>
      <table className={`${styles.table} ${own.board}`} data-testid="terminal-econ-table">
        <caption className={styles.caption}>Latest official prints</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col" className={styles.phoneWrap}>Latest</th>
            <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`}
              title="The print before, and the change from it: points for a rate, basis points for a daily rate, the count for a count, percent for a level">Prior, change</th>
            <th scope="col" className={`${own.textCol} ${styles.phoneWrap} ${styles.snugWrap}`}>Released, next</th>
          </tr>
        </thead>
        {themes.map((t) => (
          <tbody key={t.key} data-testid={`terminal-econ-theme-${t.key}`}>
            <tr>
              <th scope="rowgroup" colSpan={4} className={own.themeHead}>{t.title}</th>
            </tr>
            {t.rows.map((r) => <Row key={r.key} r={r} />)}
            {t.missing.map((m) => (
              <tr key={m} data-testid={`terminal-econ-missing-${t.key}`}>
                <td colSpan={4} className={`${own.textCol} ${styles.phoneWrap} ${styles.snugWrap}`}>
                  <span className={own.sub}>{`${m}: not among the economic series this server publishes.`}</span>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Footer({ credits }) {
  return (
    <div className={own.footer} data-testid="terminal-econ-footer">
      <p>
        Each figure is the agency&apos;s own, as published. A row marked UCT calculation is a change UCT works out from the
        agency&apos;s own index. A series name opens it on the chart.
      </p>
      {credits.map((c) => <p key={c.key} data-testid="terminal-econ-credit" data-source={c.key}>{c.text}</p>)}
    </div>
  )
}

function Economy({ code, inPanel }) {
  const read = useMarketRead(ECON_LATEST_URL, { refreshInterval: ECON_POLL_MS })
  const [today] = useState(() => etToday(Date.now()))
  const view = useMemo(() => economyRead(read.body, { today }), [read.body, today])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(ECON_SOURCE, view.newestT) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-econ" data-state={state}>{body}</div>
  )
  if (read.loading) return frame('loading', <PanelSkeleton label="Loading the economy board" testId="terminal-econ-loading" />)
  if (!ok) {
    const f = econFailure(read.body ? null : read.error)
    return frame(f.state, (
      <PanelState kind={f.kind} testId="terminal-econ-error" title={f.title}
        action={f.retry ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}>
        {f.hint || (f.retry ? `Retry, or run ${code} again.` : null)}
      </PanelState>
    ))
  }
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-econ-stale-read">{econFailure(read.error).title} Showing the last read.</p> : null}
      <Ahead ahead={view.ahead} />
      <Board themes={view.themes} />
      <Footer credits={view.credits} />
    </>
  ))
}

export default function EconomyPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || ECON_CODE
  return <Economy code={code} inPanel={inPanel} />
}
