// app/src/components/chart/pane/StableStockChart.jsx
//
// ⭐ THE PANE'S STOCKCHART RENDERS WHEN SOMETHING IT SHOWS CHANGES (switch render cuts, 2026-11-20).
//
// A symbol switch on the /charts board re-rendered each chart's StockChart (the heaviest component in
// the app) three times with the SAME symbol before the one render that shows the new one: when the
// colour group changed (the whole board re-rendered), when the chart widget settled the request, and
// twice more after the switch as the pane's own state moved. Measured on production (2026-11-20, a
// render probe on the flip proof): every prop that changed in those renders was a callback, re-created by
// a parent render with the same behaviour.
//
// So the pane renders StockChart through `React.memo`, and hands it the callbacks below as trampolines
// (one function per prop for the chart's life, calling the newest one the pane passed). A render with
// only new callback identities is skipped; any other prop change renders exactly as before.
//
// ⛔ ONLY THESE CALLBACKS. Each is called on an event or published to a sink that does not depend on
// which function object did it (StockChart's uses were read one by one: a settings write, a symbol or
// timeframe request, the watermark's adjust end and anchor migration, the visible range, the date-nav
// API, the drawn-bar count; the pane's own three are inline arrows that write a ref and forward to the
// host's prop by name). A callback whose IDENTITY means something (a `subscribe*` that StockChart must
// re-subscribe through when it changes, a render prop) stays out of this list and keeps comparing by
// identity, so it still renders StockChart when it changes.
//
// ⭐ AND THE PER-SYMBOL VALUES BELOW RIDE A CHANNEL, NOT A PROP (metadata islands, 2026-11-20). The pane's
// next-earnings date (`nextEarningsHint`) is an ANSWER: the research snapshot or the watchlist meta landing after
// a switch. As a prop, each landing re-rendered StockChart to move one "E" chip. Here it is staged into a channel
// the chart's metadata feed reads (`chart/chartMetaStore.js::createValueChannel`), so a landing re-renders the
// feed and the chart redraws the chip without rendering. StockChart takes the channel as
// `nextEarningsHintChannel`; a host that renders StockChart directly still passes the plain prop.

import { memo, useLayoutEffect, useState } from 'react'
import StockChart from '../../StockChart'
import { createValueChannel } from '../chartMetaStore'

const TRAMPOLINED_PROPS = Object.freeze([
  'onSettingsPersist', 'onSymbolChange', 'onTfChange', 'onWatermarkAdjustEnd', 'onWatermarkAnchor',
  'onTimeRangeChange', 'onDateNavApi', 'onDrawnBarCount',
])

const MemoStockChart = memo(StockChart)

/** One holder per pane for its chart's life: the newest props, one trampoline per callback, the hint channel. */
function makeHolder() {
  let latest = {}
  const tramp = {}
  for (const k of TRAMPOLINED_PROPS) tramp[k] = (...a) => latest[k]?.(...a)
  return { tramp, hint: createValueChannel(null), setLatest: (props) => { latest = props } }
}

/** Pure: the props StockChart gets, each listed callback swapped for its trampoline, the hint for its channel. */
function stableProps(props, holder) {
  const out = { ...props }
  // Absent stays absent (StockChart reads `typeof onX === 'function'` as "the host supports this").
  for (const k of TRAMPOLINED_PROPS) if (typeof props[k] === 'function') out[k] = holder.tramp[k]
  delete out.nextEarningsHint
  out.nextEarningsHintChannel = holder.hint
  return out
}

export default function StableStockChart(props) {
  const [holder] = useState(makeHolder)
  // The newest callbacks, read when a trampoline is called. Written during render, before StockChart
  // renders, so a call from inside StockChart's render or effects sees this render's props.
  holder.setLatest(props)
  // The newest hint, staged the same way (a StockChart render in this pass reads it); a hint-only change skips
  // StockChart (the memo) and reaches its metadata feed when the channel publishes.
  holder.hint.stage(props.nextEarningsHint ?? null)
  useLayoutEffect(() => { holder.hint.publish() })
  // `viewLockKey` again, by name: the same value the spread already carries (a no-op at runtime), written out
  // because the persistence census (tools/persistence_census.mjs) cannot see through `stableProps`'s copy, and
  // the key StockChart persists the view lock under must resolve to the callers' literal
  // (src/lib/persistence/persistenceManifest.test.js, "resolves every key").
  return <MemoStockChart {...stableProps(props, holder)} viewLockKey={props.viewLockKey} />
}
