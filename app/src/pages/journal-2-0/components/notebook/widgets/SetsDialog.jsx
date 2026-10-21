import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import { tfText } from '../../../../../widgets/registry'
import {
  loadSets, saveSets, setRefusal, newId, SET_TFS, MAX_CHARTS_PER_SET, MAX_SETS, NAME_MAX,
} from '../../../lib/notebookSets'
import styles from './SetsDialog.module.css'

/**
 * Notebook widgets Task 17 (wave 5): the "Chart sets" dialog. Make, rename, reorder and delete the member's
 * chart sets, start one from a watchlist or a theme's holdings, and delete saved presets.
 *
 * ⛔ LAZY. Nothing on the first open imports this file: the / menu's "Manage chart sets" row loads it with a
 * dynamic import and calls openSetsDialog, which mounts it on its own root (so no host on the first open
 * carries a slot for it). Every save goes through saveSets, the one read-modify-write of the preference.
 * Reordering is up and down buttons, never drag, so touch works. Every control is at least 44 px.
 */

export const WATCHLISTS_URL = '/api/watchlists?include_prebuilt=0'
export const THEMES_URL = '/api/theme-performance'

const symOf = (it) => (typeof it === 'string' ? it : it?.sym)
const capped = (syms) => syms.filter(Boolean).slice(0, MAX_CHARTS_PER_SET).map((symbol) => ({ symbol, tf: 'D' }))

async function getJson(url) {
  try {
    const res = await fetch(url, { credentials: 'include' })
    return res && res.ok ? await res.json() : null
  } catch { return null }
}

const move = (list, i, by) => {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function IconButton({ icon, label, onClick, disabled }) {
  return (
    <button type="button" className={styles.icon} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <UIcon name={icon} size={16} gold={false} />
    </button>
  )
}

function SetEditor({ draft, onChange, onSave, onCancel, busy }) {
  const charts = draft.charts
  const setChart = (i, patch) => onChange({ ...draft, charts: charts.map((c, k) => (k === i ? { ...c, ...patch } : c)) })
  const full = charts.length >= MAX_CHARTS_PER_SET
  return (
    <form className={styles.editor} onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <label className={styles.field}>
        <span>Set name</span>
        <input
          className={styles.input} value={draft.name} maxLength={NAME_MAX} placeholder="Semis"
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>
      <ol className={styles.charts}>
        {charts.map((c, i) => (
          <li key={i} className={styles.chartRow}>
            <input
              className={styles.input} value={c.symbol} aria-label={`Chart ${i + 1} symbol`} placeholder="NVDA"
              onChange={(e) => setChart(i, { symbol: e.target.value.toUpperCase().trim() })}
            />
            <select
              className={styles.select} value={c.tf} aria-label={`Chart ${i + 1} timeframe`}
              onChange={(e) => setChart(i, { tf: e.target.value })}
            >
              {SET_TFS.map((tf) => <option key={tf} value={tf}>{tfText(tf)}</option>)}
            </select>
            <IconButton icon="chevronUp" label={`Move chart ${i + 1} up`} disabled={i === 0}
              onClick={() => onChange({ ...draft, charts: move(charts, i, -1) })} />
            <IconButton icon="chevronDown" label={`Move chart ${i + 1} down`} disabled={i === charts.length - 1}
              onClick={() => onChange({ ...draft, charts: move(charts, i, 1) })} />
            <IconButton icon="x" label={`Remove chart ${i + 1}`}
              onClick={() => onChange({ ...draft, charts: charts.filter((_, k) => k !== i) })} />
          </li>
        ))}
      </ol>
      <p className={styles.hint}>
        {charts.length} of {MAX_CHARTS_PER_SET} charts.{full ? ' This set is full.' : ''}
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={full}
          onClick={() => onChange({ ...draft, charts: [...charts, { symbol: '', tf: 'D' }] })}>
          <UIcon name="plus" size={14} gold={false} /> Add a chart
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.primary} disabled={busy}>Save set</button>
      </div>
    </form>
  )
}

/** Pick a watchlist or a theme and start a draft set from its first 12 names. */
function StartFrom({ onPick }) {
  const [source, setSource] = useState(null)   // 'watchlist' | 'theme'
  const [options, setOptions] = useState(null) // [{id, name, syms}] | 'failed'
  const [choice, setChoice] = useState('')

  const open = async (kind) => {
    setSource(kind)
    setOptions(null)
    setChoice('')
    if (kind === 'watchlist') {
      const data = await getJson(WATCHLISTS_URL)
      setOptions(Array.isArray(data)
        ? data.filter((l) => Array.isArray(l?.items) && l.items.length)
          .map((l) => ({ id: String(l.id), name: l.name, syms: l.items.map(symOf) }))
        : 'failed')
    } else {
      const data = await getJson(THEMES_URL)
      const themes = Array.isArray(data?.themes) ? data.themes : null
      setOptions(themes
        ? themes.map((t) => ({
          id: String(t.ticker || t.name), name: t.name || t.ticker,
          // Owner rows only, as the tracker counts a theme (engine-overlay members never move it).
          syms: (t.holdings || []).filter((h) => h.source !== 'engine').map((h) => h.sym),
        })).filter((t) => t.syms.length)
        : 'failed')
    }
  }

  const picked = Array.isArray(options) ? options.find((o) => o.id === choice) : null
  return (
    <div className={styles.startFrom}>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => open('watchlist')}>Start from a watchlist</button>
        <button type="button" className={styles.btn} onClick={() => open('theme')}>Start from a theme</button>
      </div>
      {source && options === null && <p className={styles.hint}>Loading…</p>}
      {options === 'failed' && (
        <p className={styles.hint} role="status">
          {source === 'watchlist' ? 'Your watchlists' : 'The themes'} couldn&apos;t be read just now. Try again.
        </p>
      )}
      {Array.isArray(options) && !options.length && (
        <p className={styles.hint}>{source === 'watchlist' ? 'You have no watchlist with names in it yet.' : 'There are no themes to start from right now.'}</p>
      )}
      {Array.isArray(options) && options.length > 0 && (
        <div className={styles.actions}>
          <select className={styles.select} value={choice} aria-label={source === 'watchlist' ? 'Watchlist' : 'Theme'}
            onChange={(e) => setChoice(e.target.value)}>
            <option value="">{source === 'watchlist' ? 'Choose a watchlist' : 'Choose a theme'}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.syms.length})</option>)}
          </select>
          <button type="button" className={styles.primary} disabled={!picked}
            onClick={() => { onPick({ id: null, name: picked.name.slice(0, NAME_MAX), charts: capped(picked.syms) }); setSource(null) }}>
            Use {picked && picked.syms.length > MAX_CHARTS_PER_SET ? `the first ${MAX_CHARTS_PER_SET}` : 'these names'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function SetsDialog({ onClose }) {
  const [doc, setDoc] = useState(null)       // null = loading; {failed} = could not read
  const [draft, setDraft] = useState(null)   // the set being edited, or null
  const [confirming, setConfirming] = useState(null) // id of the set or preset asked to delete
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    loadSets({ fresh: true }).then((d) => { if (alive.current) setDoc(d) })
    return () => { alive.current = false }
  }, [])

  const commit = async (next, done) => {
    setBusy(true)
    setMessage('')
    const res = await saveSets(next)
    if (!alive.current) return
    setBusy(false)
    if (res.ok) { setDoc(res.doc); done?.() } else setMessage(res.reason)
  }

  const saveDraft = () => {
    const charts = draft.charts.filter((c) => c.symbol)
    const set = { id: draft.id || newId('s'), name: draft.name.trim(), charts }
    const why = setRefusal(set)
    if (why) { setMessage(why); return }
    const exists = doc.sets.some((s) => s.id === set.id)
    if (!exists && doc.sets.length >= MAX_SETS) { setMessage(`You can keep up to ${MAX_SETS} chart sets.`); return }
    commit({ sets: exists ? doc.sets.map((s) => (s.id === set.id ? set : s)) : [...doc.sets, set] }, () => setDraft(null))
  }

  const sets = doc?.sets || []
  const presets = doc?.presets || []
  return (
    <Sheet open onClose={onClose} title="Chart sets" labelledByTitle maxWidth={560}>
      <div className={styles.body}>
        {message && <p className={styles.message} role="status">{message}</p>}
        {doc === null && <p className={styles.hint}>Loading your chart sets…</p>}
        {doc?.failed && <p className={styles.hint} role="status">Your chart sets couldn&apos;t be read just now. Close this and try again.</p>}
        {doc && !doc.failed && draft && (
          <SetEditor draft={draft} onChange={setDraft} onSave={saveDraft} onCancel={() => { setDraft(null); setMessage('') }} busy={busy} />
        )}
        {doc && !doc.failed && !draft && (
          <>
            <p className={styles.hint}>
              Type <code>/set</code> and a set&apos;s name in a note to put all its charts in at once.
            </p>
            {sets.length === 0 && <p className={styles.empty}>No chart sets yet.</p>}
            <ul className={styles.list}>
              {sets.map((s, i) => (
                <li key={s.id} className={styles.row}>
                  <span className={styles.name}>{s.name}</span>
                  <span className={styles.count}>{s.charts.length} chart{s.charts.length === 1 ? '' : 's'}</span>
                  <span className={styles.spacer} />
                  {confirming === s.id ? (
                    <>
                      <span className={styles.ask}>Delete {s.name}?</span>
                      <button type="button" className={styles.btn} disabled={busy}
                        onClick={() => commit({ sets: sets.filter((x) => x.id !== s.id) }, () => setConfirming(null))}>Delete</button>
                      <button type="button" className={styles.btn} onClick={() => setConfirming(null)}>Keep</button>
                    </>
                  ) : (
                    <>
                      <IconButton icon="chevronUp" label={`Move ${s.name} up`} disabled={busy || i === 0}
                        onClick={() => commit({ sets: move(sets, i, -1) })} />
                      <IconButton icon="chevronDown" label={`Move ${s.name} down`} disabled={busy || i === sets.length - 1}
                        onClick={() => commit({ sets: move(sets, i, 1) })} />
                      <IconButton icon="edit" label={`Rename or edit ${s.name}`}
                        onClick={() => { setDraft({ ...s, charts: s.charts.map((c) => ({ ...c })) }); setMessage('') }} />
                      <IconButton icon="trash" label={`Delete ${s.name}`} onClick={() => setConfirming(s.id)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={sets.length >= MAX_SETS}
                onClick={() => { setDraft({ id: null, name: '', charts: [{ symbol: '', tf: 'D' }] }); setMessage('') }}>
                <UIcon name="plus" size={14} gold={false} /> New chart set
              </button>
            </div>
            <StartFrom onPick={(d) => { setDraft(d); setMessage('') }} />
            <h3 className={styles.heading}>My presets</h3>
            {presets.length === 0 ? (
              <p className={styles.empty}>No presets yet. Use “Save as preset” on a widget in a note.</p>
            ) : (
              <ul className={styles.list}>
                {presets.map((p) => (
                  <li key={p.id} className={styles.row}>
                    <span className={styles.name}>{p.name}</span>
                    <span className={styles.spacer} />
                    {confirming === p.id ? (
                      <>
                        <span className={styles.ask}>Delete {p.name}?</span>
                        <button type="button" className={styles.btn} disabled={busy}
                          onClick={() => commit({ presets: presets.filter((x) => x.id !== p.id) }, () => setConfirming(null))}>Delete</button>
                        <button type="button" className={styles.btn} onClick={() => setConfirming(null)}>Keep</button>
                      </>
                    ) : (
                      <IconButton icon="trash" label={`Delete preset ${p.name}`} onClick={() => setConfirming(p.id)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

let _open = null

/** Mount the dialog on its own root (one at a time) and unmount it on close. */
export function openSetsDialog() {
  if (_open) return _open
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  _open = close
  root.render(createElement(SetsDialog, { onClose: close }))
  return close
}
