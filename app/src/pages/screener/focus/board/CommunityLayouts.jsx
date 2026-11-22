// "Community layouts": the scan-board arrangements members have shared, in one window. Using one
// copies it into My layouts (boardModel.adoptLayout); the member's own shared layouts are listed
// with where each stands; an admin also sees what waits for review and what was reported.
// A shared layout is an arrangement and a name. It never carries screens or filters.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Menu, { MenuItem } from '../Menu'
import { WIDGETS, COLS, ROWS, MAX_MINE, cleanWidgets } from './boardModel'
import { listCommunity, unpublishLayout, countUse, reportLayout, adminAct, REPORT_REASONS } from './communityApi'
import focus from '../FocusScreener.module.css'
import s from './Board.module.css'

const SHORT = { results: 'Results', chart: 'Chart', details: 'Why', news: 'News', screens: 'Screens' }
const pct = (v, of) => `${(v / of) * 100}%`

// A small picture of a layout: each widget as a labelled box on the board's own grid.
export function LayoutThumb({ widgets }) {
  const ws = cleanWidgets(widgets) || []
  return (
    <div className={s.thumb} role="img" aria-label={`Layout with ${ws.map(w => WIDGETS[w.type].name).join(', ')}`}>
      {ws.map(w => (
        <span key={w.type} className={s.thumbBox} data-tall={w.w <= 4 && w.h > w.w ? '' : undefined} style={{ left: pct(w.x, COLS), top: pct(w.y, ROWS), width: pct(w.w, COLS), height: pct(w.h, ROWS) }}>
          <span className={s.thumbLabel}>{SHORT[w.type]}</span>
        </span>
      ))}
    </div>
  )
}

const STATUS = { pending: 'Waiting for review', approved: 'Shared', declined: 'Not approved' }
const usedLine = n => (n === 0 ? 'not used yet' : n === 1 ? 'used once' : `used ${n} times`)

function Card({ item, children, sub }) {
  return (
    <li className={s.cmCard} data-testid={`community-item-${item.id}`}>
      <LayoutThumb widgets={item.layout?.widgets} />
      <div className={s.cmMeta}>
        <span className={s.cmName}>{item.name}</span>
        <span className={s.cmBy}>{sub}</span>
      </div>
      <div className={s.cmActions}>{children}</div>
    </li>
  )
}

export default function CommunityLayouts({ board, api, isAdmin = false, reloadKey = 0, onShare, onClose, say }) {
  const [state, setState] = useState({ loading: true, error: null, items: [], mine: [], queue: [] })
  const [busy, setBusy] = useState(null)
  const box = useRef(null)
  const titleId = useId()
  const alive = useRef(true)
  // Set on every mount: a development double-mount must not leave the window deaf to its own answers.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    const out = await listCommunity()
    if (!alive.current) return
    if (!out.ok) { setState(st => ({ ...st, loading: false, error: out.error })); return }
    const list = v => (Array.isArray(v) ? v.filter(i => i && typeof i.id === 'string' && cleanWidgets(i.layout?.widgets)) : [])
    setState({ loading: false, error: null, items: list(out.data.items), mine: list(out.data.mine), queue: list(out.data.queue) })
  }, [])
  // Read when the window opens and again after the member shares a layout (`reloadKey`).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load, reloadKey])

  useEffect(() => {
    const opener = document.activeElement
    box.current?.querySelector('button')?.focus()
    return () => { if (opener && opener.isConnected) opener.focus?.() }
  }, [])
  // Found on the live site: after "Stop sharing" the button that held the focus is gone, the
  // focus falls to the page behind, and Escape and Tab no longer reach this window. After every
  // render, a focus that was lost (or sits on a button that just became disabled) comes back to
  // the window itself. A focus that is somewhere real (the name box on top of it) is left alone.
  useEffect(() => {
    const el = document.activeElement
    const lost = !el || el === document.body || (box.current?.contains(el) && el.disabled)
    if (lost) box.current?.focus()
  })
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const list = [...box.current.querySelectorAll('button:not([disabled])')]
    if (!list.length) return
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const use = item => {
    if (board.mine.length >= MAX_MINE) { say(`You have ${MAX_MINE} layouts of your own. Delete one to add another.`); return }
    if (!api.adoptLayout(item.name, item.layout.widgets)) { say('That layout could not be added.'); return }
    if (!item.mine) countUse(item.id) // a count for the author; nothing here waits on it
    say(`Added “${item.name}” to My layouts`)
    onClose()
  }
  const act = async (item, run, done) => {
    setBusy(item.id)
    const out = await run()
    if (!alive.current) return
    setBusy(null)
    if (!out.ok) { say(out.error); return }
    if (done) say(done)
    load()
  }
  const report = (item, reason) => act(item, () => reportLayout(item.id, reason), 'Reported. Thank you.')
  const stop = item => act(item, () => unpublishLayout(item.id), `Stopped sharing “${item.name}”`)
  const admin = (item, action, done) => act(item, () => adminAct(item.id, action), done)

  const { loading, error, items, mine, queue } = state
  const others = items.filter(i => !i.mine)
  return (
    <div className={focus.dialogScrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={s.cmWindow} onKeyDown={onKeyDown} data-testid="community-layouts">
        <div className={s.cmHead}>
          <div>
            <h2 id={titleId} className={focus.dialogTitle}>Community layouts</h2>
            <p className={s.cmSub}>Layouts other members shared. Using one adds a copy to My layouts.</p>
          </div>
          <span className={focus.spacer} />
          <button type="button" className={focus.btn} onClick={onShare}>Share my layout…</button>
          <button type="button" className={focus.btn} onClick={onClose}>Close</button>
        </div>
        <div className={s.cmBody}>
          {loading && <p className={s.cmNote} role="status">Loading community layouts…</p>}
          {!loading && error && (
            <div className={s.cmNote} role="alert">
              <span>{error}</span>
              <button type="button" className={focus.btn} onClick={() => { setState(st => ({ ...st, loading: true, error: null })); load() }}>Try again</button>
            </div>
          )}
          {!loading && !error && (
            <>
              {isAdmin && queue.length > 0 && (
                <section aria-label="For review">
                  <h3 className={s.cmHeading}>For review <span className={s.cmCount}>{queue.length}</span></h3>
                  <ul className={s.cmGrid}>
                    {queue.map(item => (
                      <Card key={item.id} item={item}
                        sub={`by ${item.author} · ${item.hidden ? 'Hidden' : item.status === 'pending' ? 'Waiting for review' : `${item.reports || 0} ${item.reports === 1 ? 'report' : 'reports'}`}`}>
                        {item.status === 'pending' && <button type="button" className={focus.btnPrimary} disabled={busy === item.id} onClick={() => admin(item, 'approve', `Approved “${item.name}”`)}>Approve</button>}
                        {item.status === 'pending' && <button type="button" className={focus.btn} disabled={busy === item.id} onClick={() => admin(item, 'decline', `Declined “${item.name}”`)}>Decline</button>}
                        {item.status !== 'pending' && !item.hidden && <button type="button" className={focus.btn} disabled={busy === item.id} onClick={() => admin(item, 'hide', `Hid “${item.name}”`)}>Hide</button>}
                        {item.status !== 'pending' && !item.hidden && item.reports > 0 && <button type="button" className={focus.btn} disabled={busy === item.id} onClick={() => admin(item, 'dismiss', 'Reports dismissed')}>Dismiss reports</button>}
                        {item.hidden && <button type="button" className={focus.btn} disabled={busy === item.id} onClick={() => admin(item, 'unhide', `“${item.name}” is listed again`)}>Unhide</button>}
                      </Card>
                    ))}
                  </ul>
                </section>
              )}
              {mine.length > 0 && (
                <section aria-label="Shared by you">
                  <h3 className={s.cmHeading}>Shared by you</h3>
                  <ul className={s.cmGrid}>
                    {mine.map(item => (
                      <Card key={item.id} item={item} sub={item.hidden ? 'Hidden by UCT' : `${STATUS[item.status] || item.status}${item.status === 'approved' ? ` · ${usedLine(item.uses || 0)}` : ''}`}>
                        <button type="button" className={focus.btn} disabled={busy === item.id} onClick={() => stop(item)}>Stop sharing</button>
                      </Card>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-label="Shared by members">
                <h3 className={s.cmHeading}>Shared by members</h3>
                {others.length === 0
                  ? <p className={s.cmNote}>{mine.length ? 'No one else has shared a layout yet.' : 'No one has shared a layout yet. Yours could be the first.'}</p>
                  : (
                    <ul className={s.cmGrid}>
                      {others.map(item => (
                        <Card key={item.id} item={item} sub={`by ${item.author} · ${usedLine(item.uses || 0)}`}>
                          <button type="button" className={focus.btnPrimary} onClick={() => use(item)}>Use layout</button>
                          {item.reported
                            ? <span className={s.cmDone}>Reported</span>
                            : (
                              <Menu label={`Report ${item.name}`} trigger="Report" align="right" width={220} triggerClassName={focus.linkBtn} disabled={busy === item.id}>
                                {REPORT_REASONS.map(([v, label]) => <MenuItem key={v} onSelect={() => report(item, v)}>{label}</MenuItem>)}
                              </Menu>
                            )}
                        </Card>
                      ))}
                    </ul>
                  )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
