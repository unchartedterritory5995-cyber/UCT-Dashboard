/**
 * Wave 13 lane 13I-2 — before and after on the closed-trade page: the chart as it stood on the
 * ENTRY day beside the chart as it stood on the EXIT day, both with the plan's levels (as 13A
 * froze them) and the fills marked.
 *
 * Reuses, rebuilds nothing:
 *   * the chart is `ChartPane` (the StockChart every surface renders), frozen with
 *     `replayCutoff` — the prop a note's frozen chart uses (ChartEmbed.jsx), which fetches up to
 *     the day and hides every bar after it;
 *   * the fills are `buildTradeMarkers` (the trade page's own BUY/SELL arrows);
 *   * the plan levels come from `GET /api/j2/notebook-visual-playbook/trades/{id}/before-after`,
 *     which reads 13A's frozen link READ-ONLY (opening this view freezes nothing);
 *   * the plan note's own chart, when it carries one, is its archived image.
 *
 * Herd-safety: two extra charts on a page that already has one, so both pass
 * `backgroundWarm={false}` (the grid's recipe, CLAUDE.md "Multi-Chart Grid Mode").
 *
 * Dark behind `notebook_visual_playbook_enabled` (latched): with the gate off nothing fetches.
 */
import { Suspense, useId } from 'react'
import useSWR from 'swr'
import lazyChunk from '../../lib/lazyChunk'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { buildTradeMarkers } from './tradePageModel'
import styles from './TradeBeforeAfter.module.css'

const ChartPane = lazyChunk(() => import('../../../../components/chart/pane/ChartPane'))

export const VISUAL_PLAYBOOK_FLAG = 'notebook_visual_playbook_enabled'
export const beforeAfterEnabled = () => notebookFlag(VISUAL_PLAYBOOK_FLAG) === true

const PLAN_COLORS = { entry: '#dcbb5e', stop: '#ef4444', target: '#22c55e' }
const PLAN_TITLES = { entry: 'Plan entry', stop: 'Plan stop', target: 'Plan target' }

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Before/after request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** The plan's levels as price lines (pure; the rail reads it). */
export function planPriceLines(plan) {
  const out = []
  for (const role of ['entry', 'stop', 'target']) {
    const v = Number(plan?.[role])
    if (Number.isFinite(v) && v > 0) {
      out.push({ price: v, color: PLAN_COLORS[role], lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: PLAN_TITLES[role] })
    }
  }
  return out
}

function FrozenChart({ symbol, day, markers, priceLines, label }) {
  return (
    <figure className={styles.chart} aria-label={label}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <div className={styles.chartBox}>
        <Suspense fallback={<div className={styles.loading} role="status">Loading chart…</div>}>
          <ChartPane
            sym={symbol}
            tf="D"
            density="mini"
            showTfBar={false}
            stored={null}
            stockChartProps={{
              height: '100%',
              replayCutoff: day,
              markers,
              priceLines,
              liveUpdates: false,
              showDrawingTools: false,
              showRangeSelector: false,
              hideJournalOverlay: true,
              backgroundWarm: false,
              // Two of these sit side by side at phone width (390px CLAUDE.md tier):
              // the shared scale-toggle (9px font) and the legend's indicator-overflow
              // chip are both HOST chrome vetoes (same shape as hideCompare/
              // hideJournalOverlay above), not user preferences, and neither clears
              // the --tap-min touch floor at this size. A quick before/after glance
              // doesn't need a live crosshair readout or an A/L/% scale picker.
              hideLegend: true,
              hideScaleToggle: true,
            }}
          />
        </Suspense>
      </div>
    </figure>
  )
}

export default function TradeBeforeAfter({ tradeId }) {
  const on = beforeAfterEnabled()
  const key = on && tradeId != null ? `/api/j2/notebook-visual-playbook/trades/${encodeURIComponent(tradeId)}/before-after` : null
  const { data, error, mutate } = useSWR(key, getJson, { revalidateOnFocus: false })
  const titleId = useId()
  if (!on) return null

  const trade = data?.trade
  const plan = data?.plan
  const markersAll = trade ? buildTradeMarkers({ ...trade, originalStop: null }, 'D').markers : []
  // The entry chart stops at the entry day, so it carries the entry arrow only.
  const beforeMarkers = markersAll.filter((m) => /^(BUY|SHORT)/.test(m.text || ''))
  const lines = planPriceLines(plan)

  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid="trade-before-after">
      <h2 id={titleId} className={styles.title}>Before and after</h2>
      {error && (
        <p className={styles.error} role="alert">
          Before and after could not be read ({error.status || 'network'}).{' '}
          <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
        </p>
      )}
      {!data && !error && <p className={styles.muted} role="status">Loading…</p>}
      {data && (
        <>
          <p className={styles.planLine}>
            {data.planStatus === 'linked' && plan ? (
              <>
                Plan levels from {plan.noteTitle ? `“${plan.noteTitle}”` : 'the frozen plan'}: entry {plan.entry ?? '—'},
                stop {plan.stop ?? '—'}, target {plan.target ?? '—'} (frozen when the plan was matched).
              </>
            ) : data.planStatus === 'member_none' ? (
              <>You marked this trade as having no plan, so only the fills are drawn.</>
            ) : (
              <>No frozen plan for this trade, so only the fills are drawn.</>
            )}
          </p>
          {/* FIN-A11Y (review R4, M-16): the arrows drawn on the two charts, in words. */}
          <p className={styles.planLine} data-testid="before-after-fills">
            Fills drawn: {String(trade.side || '').toLowerCase() === 'short' ? 'short' : 'long'} entry
            at {trade.entryPrice ?? '—'} on {trade.entryDay}, exit at {trade.exitPrice ?? '—'} on {trade.exitDay}.
          </p>
          <div className={styles.pair}>
            <FrozenChart symbol={trade.symbol} day={trade.entryDay} markers={beforeMarkers} priceLines={lines}
              label={`Before: ${trade.symbol} as of the entry day, ${trade.entryDay}`} />
            <FrozenChart symbol={trade.symbol} day={trade.exitDay} markers={markersAll} priceLines={lines}
              label={`After: ${trade.symbol} as of the exit day, ${trade.exitDay}`} />
          </div>
          {data.planChart?.image?.url && (
            <figure className={styles.planChart}>
              <img src={data.planChart.image.url} alt={`The chart in the plan note, frozen ${data.planChart.asOf || ''}`}
                loading="lazy" className={styles.planImg} />
              <figcaption className={styles.muted}>
                The chart you planned on{data.planChart.setupTag ? ` (${data.planChart.setupTag})` : ''}, frozen {data.planChart.asOf}.
              </figcaption>
            </figure>
          )}
        </>
      )}
    </section>
  )
}
