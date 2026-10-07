// ── UCT Agent HOST: the Charts workspace's binding for its target kinds ─────
//
// Built by ChartsWorkspace from what it already owns: the `chartApiById`
// registry every mounted ChartWidget registers into (each carries an `agent`
// adapter — read + commit through the widget's OWN sinks) and the visible board
// (to say WHERE a chart is). The host never touches prefs or React state.
// A future feature with its own target kind adds its own binding here
// (e.g. `host.widgets`) — capability modules then reach it through their kind.
//
// A chart's ref is its persisted widget id (+ "~tabId" for an extra chart tab).
// Only charts on the visible grid are targets; popped-out / floating ones are not.

const refOf = (r) => (r.tabId ? `${r.chartId}~${r.tabId}` : r.chartId)

function positionWord(w, all) {
  if (all.length < 2) return ''
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  const spreadX = new Set(all.map(o => (o.x + o.w / 2) < 12)).size > 1
  const spreadY = new Set(all.map(o => (o.y + o.h / 2) < 10)).size > 1
  const v = spreadY ? (cy < 10 ? 'top' : 'bottom') : ''
  const h = spreadX ? (cx < 12 ? 'left' : 'right') : ''
  return [v, h].filter(Boolean).join('-')
}

export function buildChartSource({ chartApiById, getWidgets }) {
  function entries() {
    const widgets = getWidgets() || []
    const byId = new Map(widgets.map(w => [w.id, w]))
    const seen = new Set()
    const out = []
    for (const api of chartApiById.current.values()) {
      if (!api || !api.agent) continue
      const r = api.agent.read()
      if (!r || !r.chartId || !byId.has(r.chartId)) continue
      const ref = refOf(r)
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push({ api, r, ref, w: byId.get(r.chartId) })
    }
    out.sort((a, b) => (a.w.y - b.w.y) || (a.w.x - b.w.x))
    const chartWidgets = out.map(e => e.w)
    return out.map((e, i) => {
      const pos = positionWord(e.w, chartWidgets)
      const linkedCount = typeof e.r.groupKey === 'string' && !e.r.groupKey.startsWith('N')
        ? widgets.filter(o => o.id !== e.r.chartId && o.color === e.r.groupKey).length
        : 0
      const name = out.length === 1 ? 'Chart' : (pos ? `${pos[0].toUpperCase()}${pos.slice(1)} chart` : `Chart ${i + 1}`)
      return {
        ...e,
        snap: {
          ref: e.ref, label: `${name} (${e.r.symbol})`, position: pos || null,
          symbol: e.r.symbol, tf: e.r.tf, cs: e.r.cs, stored: e.r.stored,
          linkedCount, group: e.r.groupKey,
        },
      }
    })
  }
  return {
    list: () => entries().map(e => e.snap),
    read: (ref) => entries().find(e => e.ref === ref)?.snap || null,
    commit: (ref, patch) => {
      const e = entries().find(x => x.ref === ref)
      return e ? e.api.agent.commit(patch) : false
    },
  }
}

export function buildWorkspaceHost({ chartApiById, getWidgets, widgetLabel }) {
  return {
    charts: buildChartSource({ chartApiById, getWidgets }),
    otherWidgets: () => (getWidgets() || []).filter(w => w.type !== 'chart').map(w => widgetLabel(w.type)),
  }
}
