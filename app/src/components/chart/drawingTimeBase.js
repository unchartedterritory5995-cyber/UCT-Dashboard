// app/src/components/chart/drawingTimeBase.js — ONE time base for stored intraday drawing points.
//
// ⭐ A numeric (intraday) point `time` is RAW UNIX SECONDS: the overlay writes the hovered bar's own
// `bars[i].t` (ChartDrawingOverlay toChart; StockChart hands it the raw series), so every hand-drawn
// point is a true instant and is immune to DST. The UCT Agent used to write a CHART time instead
// (drawingTimeFor → ET wall clock read as UTC, always the 09:30 ET open of a day). From 2026-11-10 it
// writes raw unix too and stamps the drawing `tb: 'unix'`.
//
// ⛔ LEGACY AGENT POINTS are recognisable without a guess at magnitude: an Agent anchor was ALWAYS the
// 09:30 ET open, i.e. a chart time ≡ 09:30:00 mod one day (34200 s). Raw unix seconds land on that
// residue only at 09:30 UTC (04:30 EST / 05:30 EDT pre-market), so a drawing WITHOUT the `tb` stamp
// whose point sits exactly there is read as a legacy chart time. Residual: a hand-drawn point on that
// exact pre-market minute reads 4-5h late (documented; the overlay could stamp `tb` to retire it).
import { fromChartTime } from './barTime'

const LEGACY_AGENT_RESIDUE = 9 * 3600 + 30 * 60   // 09:30 wall clock as a chart time

export function isLegacyChartTimePoint(t, drawing = null) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return false
  if (drawing && drawing.tb === 'unix') return false
  return (((t % 86400) + 86400) % 86400) === LEGACY_AGENT_RESIDUE
}

/** A stored numeric point time → true unix seconds (string D/W/M times pass through). */
export function pointUnixTime(t, drawing = null) {
  return isLegacyChartTimePoint(t, drawing) ? fromChartTime(t) : t
}

/** The drawing with every legacy chart-time point rewritten to raw unix and stamped `tb: 'unix'`.
 *  Only for a drawing the Agent is ALREADY rewriting (a move) — never as a read-time normalisation
 *  (drawingSchema rule 1: points are not rewritten on read). */
export function toUnixTimeBase(drawing) {
  if (!drawing || !Array.isArray(drawing.points)) return drawing
  return { ...drawing, tb: 'unix', points: drawing.points.map(p => (p && isLegacyChartTimePoint(p.time, drawing) ? { ...p, time: fromChartTime(p.time) } : p)) }
}
