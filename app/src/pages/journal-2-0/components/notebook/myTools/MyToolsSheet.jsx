import { useCallback, useEffect, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import SegmentedNav from '../../../../../components/mobile/SegmentedNav'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import WidgetsTab from './WidgetsTab'
import RoutinesTab from './RoutinesTab'
import TrackersTab from './TrackersTab'
import TemplatesTab from './TemplatesTab'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { TABS, TAB_KEYS, COMING_SOON } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * My tools (spec 5.8): the one place a member manages what they built. Four tabs, Widgets · Routines · Trackers ·
 * Templates; wave 8 builds Widgets, wave 9 Routines and Trackers (Task 9.18), and wave 11 Templates (Task 11.19, the
 * member's own templates). While wave 11 is off Templates says "coming soon" with no controls at all.
 *
 * Desktop: a centered dialog. Touch: the Sheet's own touch form; at 640 px and narrower a FULL-SCREEN sheet, the
 * tabs a segmented control, rows 56 px, every row's actions in a ContextPopover.
 *
 * The Sheet owns the dialog contract: it traps Tab inside, focuses the panel, closes on Escape (only when it is the
 * topmost sheet), and returns focus to whatever opened it. Panels inside the Widgets tab (a widget's notes, its
 * version history, rename, delete) push in place inside this ONE sheet, so Escape there goes back one level first
 * (WidgetsTab's own key handler runs before the Sheet's).
 *
 * ⛔ LAZY: mounted only by openMyTools.js, which only dynamic imports reach.
 */
export default function MyToolsSheet({ onClose, tab = 'widgets', defId = null, editor = null, uid = null, navigate = null, seek = 0 }) {
  const phone = useIsPhone()
  const [active, setActive] = useState(TAB_KEYS.includes(tab) ? tab : 'widgets')
  const tabsRef = useRef(null)

  // Closing is once: the back button, a note link's own history move and the close button can all arrive together.
  const closed = useRef(false)
  const closeOnce = useCallback(() => {
    if (closed.current) return
    closed.current = true
    onClose?.()
  }, [onClose])
  // The back button (or any history move) closes My tools rather than moving the page under it, as the chart sets
  // dialog does: the Sheet keeps no history entry of its own.
  useEffect(() => {
    window.addEventListener('popstate', closeOnce)
    return () => window.removeEventListener('popstate', closeOnce)
  }, [closeOnce])
  // Asked again while open (openMyTools called again): show the tab asked for; a widget is on the Widgets tab.
  const [seenSeek, setSeenSeek] = useState(seek)
  if (seek !== seenSeek) {
    setSeenSeek(seek)
    setActive(defId ? 'widgets' : (TAB_KEYS.includes(tab) ? tab : 'widgets'))
  }

  // Arrow keys move between the tabs (the tabs pattern): the segmented control's buttons are ordinary buttons, so
  // the keys are read here, around it, and the tab that takes focus is the one shown.
  const onTabsKey = useCallback((e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }[e.key]
    if (step == null) return
    const at = TAB_KEYS.indexOf(active)
    const next = step === 'first' ? 0 : step === 'last' ? TAB_KEYS.length - 1
      : (at + step + TAB_KEYS.length) % TAB_KEYS.length
    e.preventDefault()
    setActive(TAB_KEYS[next])
    const buttons = tabsRef.current?.querySelectorAll('[role="tab"]')
    buttons?.[next]?.focus()
  }, [active])

  const label = TABS.find(([k]) => k === active)?.[1] || 'Widgets'
  // Read per render (the flag is latched per tab, so it never flips under an open sheet).
  const templatesOn = widgetsWaveOn(11)
  const soon = active === 'templates' && templatesOn ? null : COMING_SOON[active]
  return (
    <Sheet open onClose={closeOnce} title="My tools" labelledByTitle variant={phone ? 'fullscreen' : 'auto'}
      maxWidth={880} className={styles.sheetPanel} bodyClassName={styles.body}>
      <div className={styles.root} data-testid="my-tools" data-phone={phone ? '' : undefined}>
        <div ref={tabsRef} className={styles.tabs} onKeyDown={onTabsKey}>
          <SegmentedNav ariaLabel="My tools" items={TABS.map(([key, l]) => ({ key, label: l }))}
            value={active} onChange={setActive} />
        </div>
        <div role="tabpanel" aria-label={label} className={styles.tabPanel} data-tab={active}>
          {active === 'widgets' && <WidgetsTab phone={phone} defId={defId} seek={seek} editor={editor} uid={uid} navigate={navigate} onCloseAll={closeOnce} />}
          {active === 'routines' && <RoutinesTab phone={phone} navigate={navigate} onCloseAll={closeOnce} />}
          {active === 'trackers' && <TrackersTab phone={phone} navigate={navigate} onCloseAll={closeOnce} />}
          {active === 'templates' && templatesOn && <TemplatesTab phone={phone} navigate={navigate} onCloseAll={closeOnce} />}
          {soon && <p className={styles.soon} data-testid="my-tools-soon">{soon}</p>}
        </div>
      </div>
    </Sheet>
  )
}
