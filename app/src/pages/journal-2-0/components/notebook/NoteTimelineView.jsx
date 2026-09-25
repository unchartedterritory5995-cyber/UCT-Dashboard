/**
 * Wave 6 (lane E, item 6) — the Timeline view, the Notebook's sixth view mode.
 *
 * Notes on a horizontal time axis (created / updated / a date property), zoomed
 * by week, month or quarter, in lanes by folder or tag. Layout is the pure
 * `lib/timeline.js`; this component draws it and owns the controls.
 *
 * ⛔ READ-ONLY IN v1, like the calendar view was, and for the same reason: a
 * drag that moves a note in time is a NOTE WRITE, and every write door needs the
 * `settleNoteWrite` treatment (the calendar only gained drag after the shared
 * `useOptimisticNoteProperty` existed). A chip OPENS the note, where the date is
 * editable — an equivalent path for keyboard and touch.
 *
 * ⛔ SAVEABLE: it REPORTS its settings up (`onSettingsChange`) so a saved view
 * stores them — `timeBy` as a property ID when it is a property, so a rename
 * cannot break the view — and restores from `initialSettings`.
 */
import { useEffect, useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import { todayET } from '../../lib/calendar'
import { datedDefs } from './NoteCalendarView'
import LockedGlyph from './LockedGlyph'
import {
  DEFAULT_TIMELINE, TIMELINE_GROUPS, TIMELINE_ZOOMS, layoutTimeline, shiftAnchor,
} from '../../lib/timeline'
import styles from './NoteTimelineView.module.css'

const ZOOM_LABEL = { week: 'Week', month: 'Month', quarter: 'Quarter' }
const GROUP_LABEL = { folder: 'Folder', tag: 'Tag' }

function sanitize(settings, dateDefs) {
  const s = { ...DEFAULT_TIMELINE, ...(settings || {}) }
  if (!TIMELINE_ZOOMS.includes(s.zoom)) s.zoom = DEFAULT_TIMELINE.zoom
  if (!TIMELINE_GROUPS.includes(s.groupBy)) s.groupBy = DEFAULT_TIMELINE.groupBy
  const validTime = s.timeBy === 'created' || s.timeBy === 'updated' || dateDefs.some((d) => d.id === s.timeBy)
  if (!validTime) s.timeBy = DEFAULT_TIMELINE.timeBy
  return s
}

export default function NoteTimelineView({
  notes = [], propertyDefs = [], onOpenNote, initialSettings = null, onSettingsChange, today = todayET,
}) {
  const dateDefs = useMemo(() => datedDefs(propertyDefs), [propertyDefs])
  const defsById = useMemo(() => new Map(dateDefs.map((d) => [d.id, d])), [dateDefs])
  const [settings, setSettings] = useState(() => sanitize(initialSettings, dateDefs))
  const [anchor, setAnchor] = useState(() => today())
  const { folders } = useJ2NoteFolders()
  const folderName = useMemo(() => {
    const byId = new Map((folders || []).map((f) => [f.id, f.name]))
    return (id) => byId.get(id)
  }, [folders])

  // Report the RESOLVED settings (what is drawn), so a save stores exactly this.
  useEffect(() => { onSettingsChange?.(settings) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useMemo(
    () => layoutTimeline(notes, { ...settings, anchor, defsById, folderName }),
    [notes, settings, anchor, defsById, folderName],
  )
  const set = (patch) => setSettings((prev) => ({ ...prev, ...patch }))
  const unit = { week: 'week', month: 'month', quarter: 'quarter' }[settings.zoom]

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Place by</span>
          <select value={settings.timeBy} onChange={(e) => set({ timeBy: e.target.value })}>
            <option value="updated">Last updated</option>
            <option value="created">Created</option>
            {dateDefs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={styles.control}>
          <span>Group by</span>
          <select value={settings.groupBy} onChange={(e) => set({ groupBy: e.target.value })}>
            {TIMELINE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </label>
        <div className={styles.zoom} role="group" aria-label="Zoom">
          {TIMELINE_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={`${styles.zoomBtn} ${settings.zoom === z ? styles.zoomOn : ''}`}
              aria-pressed={settings.zoom === z}
              onClick={() => set({ zoom: z })}
            >
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} onClick={() => setAnchor((a) => shiftAnchor(a, settings.zoom, -1))}
            aria-label={`Previous ${unit}`}>
            <UIcon name="chevronDown" size={12} gold={false} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <span className={styles.windowLabel} aria-live="polite">{layout.window.label}</span>
          <button type="button" className={styles.navBtn} onClick={() => setAnchor((a) => shiftAnchor(a, settings.zoom, 1))}
            aria-label={`Next ${unit}`}>
            <UIcon name="chevronRight" size={12} gold={false} />
          </button>
          <button type="button" className={styles.navBtn} onClick={() => setAnchor(today())}>Today</button>
        </div>
      </div>

      <div className={styles.scroller}>
        {layout.lanes.length === 0 ? (
          <p className={styles.empty}>Nothing placed in this {unit}.</p>
        ) : (
          <table className={styles.grid}>
            <caption className={styles.srOnly}>{`Notes by ${GROUP_LABEL[settings.groupBy].toLowerCase()}, ${layout.window.label}`}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.laneHead}>{GROUP_LABEL[settings.groupBy]}</th>
                {layout.window.buckets.map((b) => <th key={b.key} scope="col" className={styles.colHead}>{b.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {layout.lanes.map((lane) => (
                <tr key={lane.key}>
                  <th scope="row" className={styles.laneHead}>{lane.label}</th>
                  {layout.window.buckets.map((b) => (
                    <td key={b.key} className={styles.cell}>
                      {(lane.cells[b.key] || []).map((n) => (
                        <button key={n.id} type="button" className={styles.chip} onClick={() => onOpenNote?.(n)}>
                          {n.title?.trim() || 'Untitled'}
                          <LockedGlyph note={n} />
                        </button>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {layout.outside > 0 && (
        <p className={styles.note}>
          {layout.outside} more {layout.outside === 1 ? 'note sits' : 'notes sit'} outside this {unit}.
        </p>
      )}
      {layout.unscheduled.length > 0 && (
        <section className={styles.unscheduled} aria-label="Unscheduled">
          <h3 className={styles.unscheduledHead}>Unscheduled ({layout.unscheduled.length})</h3>
          <div className={styles.unscheduledList}>
            {layout.unscheduled.map((n) => (
              <button key={n.id} type="button" className={styles.chip} onClick={() => onOpenNote?.(n)}>
                {n.title?.trim() || 'Untitled'}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
