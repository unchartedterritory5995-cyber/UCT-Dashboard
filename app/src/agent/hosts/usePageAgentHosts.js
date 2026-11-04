// ── UCT Agent PAGE HOSTS: the one-line hooks a page calls (W2-C1) ────────────────────────────────────────
//
// Each hook takes the page's LIVE values (its own hook results and doors), builds the page host ONCE
// (pageHosts.js) over a closure the hook refreshes after every render, and registers it with
// AgentProvider. The page re-renders as it always did; the host reads the latest values when the Agent
// asks. Outside a provider (tests, pop-outs) every hook registers nothing, so a page renders exactly as
// before.
//
//   ScannerShell / FocusScreener:  useScreenerAgentHost({ rows, total, current, edited, filters, loading, saved, starters, applyScreen, refresh })
//   Breadth:                       useBreadthAgentHost({ tab, days, topDate, rowCount, columns, live, loading })
//   Calendar:                      useCalendarAgentHost({ data, weekLabel, view, loading })
//   JournalLayout:                 useJournalAgentHost({ notes?, refresh? })

import { useEffect, useState } from 'react'
import { mutate as globalMutate } from 'swr'
import { useAgentPageHost, useAgentApp } from '../agentApp'
import useSavedScreens from '../../pages/screener/hooks/useSavedScreens'
import useJ2Notes from '../../pages/journal-2-0/hooks/useJ2Notes'
import { buildScreenerPageHost, buildBreadthPageHost, buildCalendarPageHost, buildJournalPageHost } from './pageHosts'

const here = () => { try { return window.location.pathname } catch { return null } }

/**
 * The host, built once over a closure (`live()` = the values of the latest render, refreshed after every
 * render — never read during one). `build(live)` returns the host; null outside a provider.
 */
function useLiveHost(app, values, build) {
  const [made] = useState(() => {
    if (!app) return null
    let latest = values
    const host = build(() => latest)
    return { host, set: (v) => { latest = v } }
  })
  useEffect(() => { made?.set(values) })
  return made?.host || null
}

export function useScreenerAgentHost(values) {
  const app = useAgentApp()
  // The saved library the page itself reads (ScreensManager / FocusScreener use the same SWR key, so this is
  // the same request, deduplicated) — for a layout that hands none in (ScannerShell).
  // Only while the Agent may show (a null SWR key fetches nothing): a member's page must not depend on SWR
  // dedup with a sibling mount to avoid an extra request (review-728-741 #2).
  const lib = useSavedScreens({ enabled: !!app?.allowed })
  const host = useLiveHost(app, { ...values, lib, app }, (live) => {
    // A layout without a "current screen" of its own (ScannerShell): the last screen the Agent opened is it.
    let applied = null
    return buildScreenerPageHost({
      read: () => {
        const v = live()
        return { rows: v.rows, total: v.total, current: v.current !== undefined ? v.current : applied, filters: v.filters, loading: v.loading, edited: v.edited }
      },
      saved: () => { const v = live(); return { saved: v.saved || v.lib?.saved || [], starters: v.starters || v.lib?.starters || [] } },
      applyScreen: (spec, item) => {
        const v = live()
        if (v.current === undefined) applied = item ? { id: item.id, name: item.name, kind: item.kind } : null
        return v.applyScreen?.(spec, item)
      },
      refreshSaved: () => { const v = live(); return v.refresh ? v.refresh() : v.lib?.refresh?.() },
      location: () => here() || '/screener',
      navigate: (to) => live().app?.navigate(to),
    })
  })
  useAgentPageHost('screener', host)
  return host
}

export function useBreadthAgentHost(values) {
  const app = useAgentApp()
  const host = useLiveHost(app, { ...values, app }, (live) => buildBreadthPageHost({
    read: () => live(),
    location: () => here() || '/breadth',
    navigate: (to) => live().app?.navigate(to),
  }))
  useAgentPageHost('breadth', host)
  return host
}

export function useCalendarAgentHost(values) {
  const app = useAgentApp()
  const host = useLiveHost(app, { ...values, app }, (live) => buildCalendarPageHost({
    read: () => live(),
    location: () => here() || '/calendar',
    navigate: (to) => live().app?.navigate(to),
  }))
  useAgentPageHost('calendar', host)
  return host
}

export function useJournalAgentHost(values = {}) {
  const app = useAgentApp()
  // The member's recent notes — the Notebook's own list hook on its own route (GET /api/j2/notes), fetched only
  // while the Agent may show here; the page may hand its own list in instead.
  const own = useJ2Notes({ sort: 'updated', limit: 30, enabled: !!app?.allowed && !values?.notes })
  const host = useLiveHost(app, { ...values, own, app }, (live) => buildJournalPageHost({
    notes: () => { const v = live(); return v.notes || v.own?.notes || [] },
    // after a create / trash: this list AND every Notebook list on the page (NotebookTab's own key-predicate refresh)
    refresh: async () => {
      const v = live()
      try { await (v.refresh ? v.refresh() : v.own?.refresh?.()) } catch { /* the lists re-read below */ }
      try { await globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes')) } catch { /* best effort */ }
    },
    location: () => here() || '/journal',
    navigate: (to) => live().app?.navigate(to),
  }))
  useAgentPageHost('journal', host)
  return host
}
