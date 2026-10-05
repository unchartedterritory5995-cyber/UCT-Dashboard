/**
 * Wave 13 lane 13B — My Playbook (`/journal-2-0/playbook`): the member's own edge, measured honestly.
 *
 * One card per tagged setup. Every number is the server's (`GET /api/j2/my-playbook`, which reads
 * `playbook_stats` — the same per-setup authority the Insights cards read), worded by ruling R3
 * (`lib/sampleSize.js`): under 10 "too few to judge" with the number behind a reveal, 10-24 "thin
 * sample" with a range, 25 and up shown plainly. EVERY number carries its n and opens the trades
 * it was computed from (the server lists them from the same rows, so the list IS the count).
 *
 * "What you wrote before losses vs wins" is `playbook_patterns`: counts over a fixed word list, both
 * counts and both n, each finding citing its trades and notes. "Patterns, not proof". No AI.
 *
 * Dark behind `notebook_playbook_enabled`: with the gate off nothing is fetched and the route sends
 * the member back to Insights.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { playbookEnabled } from '../../lib/myPlaybookLink'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { WORDING } from '../../lib/sampleSize'
import { cardStats, findingText } from '../../lib/playbookFormat'
import styles from './MyPlaybook.module.css'

const BASE = '/api/j2/my-playbook'

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`My Playbook request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** The load is the click (it pulls the note-create door in with it). */
async function defaultSaveSnapshot(payload) {
  const { createPlaybookSnapshotNote } = await import('../../lib/playbookSnapshot')
  return createPlaybookSnapshotNote(payload)
}

const noteHref = (id) => `/journal/notebook?note=${encodeURIComponent(id)}`
const tradeHref = (id) => `/journal-2-0/trade/${encodeURIComponent(id)}`

/** One number, worded by its sample (R3), with its n beside it and its trades one click away. */
export function StatCell({ label, stat, fmt, onDrill }) {
  const n = stat?.n ?? 0
  const value = fmt(stat?.value)
  const nChip = <span className={styles.n} data-n={n}>n={n}</span>
  const drillBtn = (
    <button type="button" className={styles.valueBtn} onClick={onDrill}
            aria-label={`${label} ${value}, show the ${n} trade${n === 1 ? '' : 's'} behind it`}>
      {value}
    </button>
  )
  let body
  if (!n) {
    body = <span className={styles.muted}>no trades</span>
  } else if (stat.band === 'too_few') {
    body = (
      <details className={styles.reveal}>
        <summary className={styles.summary}>{WORDING.too_few}</summary>
        {drillBtn}
      </details>
    )
  } else if (stat.band === 'thin') {
    const range = Array.isArray(stat.range) && !stat.noRange
      ? <span className={styles.range}>, likely {fmt(stat.range[0])} to {fmt(stat.range[1])}</span>
      : null
    body = <>{drillBtn}<span className={styles.thin}> {WORDING.thin}{range}</span></>
  } else {
    body = drillBtn
  }
  return (
    <div className={styles.stat} data-stat={label}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{body}{' '}{nChip}</span>
    </div>
  )
}

function Drill({ setup, idx, item, trades, onClose }) {
  const rows = trades.filter(item.drill)
  return (
    <section className={styles.drill} aria-labelledby={`pb-drill-${idx}`} data-testid="playbook-drill">
      <div className={styles.drillHead}>
        <h4 id={`pb-drill-${idx}`} className={styles.drillTitle}>
          {setup} {item.label.toLowerCase()}: the {rows.length} {item.drillLabel} behind it
        </h4>
        <button type="button" className={styles.linkBtn} onClick={onClose}>Close</button>
      </div>
      <table className={styles.table}>
        <thead>
          <tr><th scope="col">Trade</th><th scope="col">Exit</th><th scope="col">Result</th><th scope="col">R</th><th scope="col">P&amp;L</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} data-trade={t.id}>
              <td><Link className={styles.link} to={tradeHref(t.id)}>{t.symbol}</Link>{t.source === 'broker' ? <span className={styles.muted}> broker</span> : null}</td>
              <td>{(t.exitDate || '').slice(0, 10)}</td>
              <td>{t.result}</td>
              <td>{t.rMultiple == null ? '—' : t.rMultiple.toFixed(2)}</td>
              <td>{t.pnlDollar.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function SetupCard({ rec, idx, notes, open, onDrill, onClose }) {
  const stats = cardStats(rec)
  const openItem = open ? stats.find((s) => s.key === open) : null
  const sampleWord = rec.sample?.wording
  return (
    <article className={styles.card} aria-labelledby={`pb-setup-${idx}`} data-setup={rec.setup} data-tour="my-playbook-setup-card">
      <div className={styles.cardHead}>
        <h3 id={`pb-setup-${idx}`} className={styles.setupName}>{rec.setup}</h3>
        <span className={styles.muted} data-n={rec.tradeCount}>
          {rec.tradeCount} trade{rec.tradeCount === 1 ? '' : 's'}{sampleWord ? ` · ${sampleWord}` : ''}
        </span>
      </div>
      <div className={styles.stats}>
        {stats.map((s) => (
          <StatCell key={s.key} label={s.label} stat={s.stat} fmt={s.fmt} onDrill={() => onDrill(s.key)} />
        ))}
      </div>
      {openItem && <Drill setup={rec.setup} idx={idx} item={openItem} trades={rec.trades || []} onClose={onClose} />}
      <div className={styles.notes} data-tour="my-playbook-notes">
        <h4 className={styles.subTitle}>From your notes</h4>
        {notes.length ? (
          <ul className={styles.noteList}>
            {notes.slice(0, 5).map((n) => (
              <li key={n.noteId}>
                <Link className={styles.link} to={noteHref(n.noteId)}>{n.title || 'Untitled note'}</Link>
                <span className={styles.muted}> · linked to {n.tradeCount} trade{n.tradeCount === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No note is linked to these trades yet.</p>
        )}
      </div>
    </article>
  )
}

function Finding({ f }) {
  const [open, setOpen] = useState(false)
  const n = f.citations.length
  return (
    <li className={styles.finding} data-finding={f.term}>
      <p className={styles.findingText}>
        {findingText(f)}{' '}
        <span className={f.leans === 'losses' ? styles.leanLoss : styles.leanWin}>
          (leans toward {f.leans})
        </span>
      </p>
      <button type="button" className={styles.linkBtn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} the {n} trade{n === 1 ? '' : 's'} and notes
      </button>
      {open && (
        <ul className={styles.citations} data-testid="pattern-citations">
          {f.citations.map((c) => (
            <li key={c.tradeId} data-cite={c.tradeId}>
              <Link className={styles.link} to={tradeHref(c.tradeId)}>{c.symbol}</Link>
              <span className={styles.muted}> {c.result}, exited {(c.exitDate || '').slice(0, 10)}. Wrote: </span>
              {c.notes.map((nt, i) => (
                <span key={nt.noteId}>
                  {i ? ', ' : ''}<Link className={styles.link} to={noteHref(nt.noteId)}>{nt.title || 'Untitled note'}</Link>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Patterns({ pat }) {
  if (!pat) return null
  return (
    <section className={styles.patterns} aria-labelledby="pb-patterns" data-testid="playbook-patterns" data-tour="my-playbook-patterns">
      <h3 id="pb-patterns" className={styles.sectionTitle}>What you wrote before losses vs wins</h3>
      <p className={styles.caption}>{pat.caption}. Counts of your own words in notes linked to a trade, read as they stood at entry.</p>
      {pat.status !== 'ok' ? (
        <p className={styles.muted}>{pat.message}</p>
      ) : pat.findings.length ? (
        <ul className={styles.findings}>
          {pat.findings.map((f) => <Finding key={f.term} f={f} />)}
        </ul>
      ) : (
        <p className={styles.muted}>No word on your list leans either way yet.</p>
      )}
    </section>
  )
}

export default function MyPlaybook({ onSaveSnapshot = defaultSaveSnapshot }) {
  const on = playbookEnabled()
  const { accountId } = useJ2SelectedAccount(on)
  const navigate = useNavigate()
  const key = on ? (accountId ? `${BASE}?accountId=${encodeURIComponent(accountId)}` : BASE) : null
  const { data, error, isLoading, mutate } = useSWR(key, getJson, { revalidateOnFocus: false, shouldRetryOnError: false })
  const [open, setOpen] = useState(null) // {setup, key}
  const [snap, setSnap] = useState(null) // {state, note?, error?}

  const drill = useCallback((setup, statKey) => setOpen({ setup, key: statKey }), [])
  const notesBySetup = useMemo(() => data?.notesBySetup || {}, [data])

  if (!on) return <Navigate to="/journal/insights" replace />

  const save = async () => {
    setSnap({ state: 'saving' })
    try {
      const note = await onSaveSnapshot(data)
      setSnap({ state: 'saved', note })
    } catch (e) {
      setSnap({ state: 'error', error: e?.message || 'Could not save the snapshot' })
    }
  }

  let body
  if (isLoading && !data) {
    body = <p className={styles.muted} data-testid="playbook-loading">Reading your trades…</p>
  } else if (error) {
    body = (
      <p className={styles.muted} role="alert">
        Couldn’t load your playbook.{' '}
        <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
      </p>
    )
  } else {
    const setups = data?.setups || []
    const untagged = data?.untagged?.count || 0
    body = (
      <>
        {untagged > 0 && (
          <p className={styles.muted} data-testid="playbook-untagged">
            {untagged} closed trade{untagged === 1 ? '' : 's'} {untagged === 1 ? 'has' : 'have'} no setup and sit{untagged === 1 ? 's' : ''} on no card.{' '}
            <Link className={styles.link} to="/journal/trades?seg=closed">Tag them in the Trade Journal</Link>
          </p>
        )}
        {setups.length ? (
          <div className={styles.grid}>
            {setups.map((rec, i) => (
              <SetupCard key={rec.setup} rec={rec} idx={i} notes={notesBySetup[rec.setup] || []}
                         open={open?.setup === rec.setup ? open.key : null}
                         onDrill={(k) => drill(rec.setup, k)} onClose={() => setOpen(null)} />
            ))}
          </div>
        ) : (
          <p className={styles.muted} data-testid="playbook-empty">Tag a closed trade with a setup and its card appears here.</p>
        )}
        <Patterns pat={data?.patterns} />
      </>
    )
  }

  return (
    <main className={styles.page} aria-labelledby="pb-title" data-testid="my-playbook">
      <Link className={styles.back} to="/journal/insights">Back to Insights</Link>
      <div className={styles.head}>
        <div>
          <h2 id="pb-title" className={styles.title}>My Playbook</h2>
          <p className={styles.sub} data-tour="my-playbook-intro">
            Your own edge, per setup. Under {data?.sample?.tooFewBelow ?? 10} trades a number is {WORDING.too_few};
            under {data?.sample?.normalFrom ?? 25} it is a {WORDING.thin} with a likely range. Every number opens its trades.
          </p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={save} data-tour="my-playbook-snapshot"
                disabled={!data || snap?.state === 'saving'}>
          {snap?.state === 'saving' ? 'Saving…' : 'Save a snapshot note'}
        </button>
      </div>
      {snap?.state === 'saved' && snap.note?.id && (
        <p className={styles.muted} role="status">
          Snapshot saved. It will not change.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => navigate(noteHref(snap.note.id))}>Open the note</button>
        </p>
      )}
      {snap?.state === 'error' && <p className={styles.muted} role="alert">{snap.error}</p>}
      {body}
    </main>
  )
}
