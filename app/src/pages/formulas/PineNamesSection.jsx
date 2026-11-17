// app/src/pages/formulas/PineNamesSection.jsx
//
// The TradingView (Pine) names section of the reference page. Loaded only when a
// member opens it: it brings the engine's refusal families with it, which the rest
// of the page does not need.

import { useMemo } from 'react'
import COVERAGE from '../../components/chart/supportLoop/doorNameCoverage.json'
import { familyOf } from '../../components/chart/builder/editorStatus'
import { SCOPE_NOTE, buildPineNames, searchPineNames } from './pineNames'
import styles from './FormulaReference.module.css'

function Row({ item }) {
  const runs = item.status === 'reachable'
  return (
    <li className={styles.entry} data-pine={item.name} data-status={item.status}>
      <code className={styles.sig}>{item.name}</code>
      <p className={styles.says}>
        <span className={runs ? styles.pineRuns : styles.pineNot}>{item.words}</span>
        {item.example && <> as <code>{item.example}</code></>}
        {item.family && <>: {item.family.label.charAt(0).toLowerCase() + item.family.label.slice(1)}</>}
      </p>
    </li>
  )
}

export default function PineNames({ query = '' }) {
  const built = useMemo(() => buildPineNames(COVERAGE, familyOf), [])
  const result = useMemo(() => searchPineNames(query, built), [query, built])
  return (
    <div data-testid="pine-names">
      <p className={styles.count} data-testid="pine-count">
        {result.query
          ? `${result.shown} of ${built.total} TradingView names match “${result.query}”`
          : `${built.runs} of ${built.total} TradingView names run`}
      </p>
      <p className={styles.groupBlurb}>{SCOPE_NOTE}</p>
      {result.query && result.shown === 0 && (
        <p className={styles.empty} data-testid="pine-empty">
          No TradingView name contains &ldquo;{result.query}&rdquo;. Try part of the name, such as{' '}
          <code>rsi</code> or <code>request.</code>
        </p>
      )}
      {result.groups.map((g) => (
        <section key={g.id} className={styles.pineGroup} data-pine-group={g.id}>
          <h4 className={styles.pineGroupTitle}>
            <code>{g.title}</code>{' '}
            <span className={styles.groupCount}>{g.runs} of {g.items.length} run</span>
          </h4>
          <ul className={styles.entries}>
            {g.items.map((it) => <Row key={it.name} item={it} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}
