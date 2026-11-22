// "Every moving average" on a chart, on or off: the ONE writer behind Ctrl+M (StockChart) and UCT Agent's
// chartSetup.setMovingAverages.
// ⛔ THROUGH `liveOverlays`, so it reads what the chart draws. A tombstoned slot must not count toward "any enabled"
// (it would make one press do nothing) and must not be switched back on (the member deleted it).
// ⭐ AND THROUGH THE AVERAGES THAT ARE INSTANCES. The `cs.overlays` averages are `movingAverage` instances now
// (`maAdoption.js`), so "every moving average" is every live instance of a definition declaring the average's
// appearance, plus any slot a host has not adopted. Their `hidden` flag is the same show/hide fact `enabled` was.
import { isOverlayRemoved, liveOverlayList } from './chartDefaults'

const isAverage = (getDefinition, i) => !!i && typeof i === 'object' && i.deleted !== true && !!getDefinition(i.defId)?.meta?.appearance

export function averageCount(cs, getDefinition) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return liveOverlayList(Array.isArray(cs?.overlays) ? cs.overlays : []).length + list.filter(i => isAverage(getDefinition, i)).length
}

export function anyAverageOn(cs, getDefinition) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return liveOverlayList(Array.isArray(cs?.overlays) ? cs.overlays : []).some(o => o?.enabled)
    || list.some(i => isAverage(getDefinition, i) && i.hidden !== true)
}

export function withAveragesShown(cs, visible, getDefinition) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return {
    ...cs,
    overlays: overlays.map(o => (isOverlayRemoved(o) ? o : { ...o, enabled: visible })),
    indicatorInstances: list.map(i => (isAverage(getDefinition, i) ? { ...i, hidden: !visible } : i)),
    preset: 'custom',
  }
}
