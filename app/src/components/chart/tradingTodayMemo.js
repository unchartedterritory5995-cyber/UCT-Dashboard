// ⭐ (2026-11-20, switch profile) `isTradingSessionTodayET`, ONE ANSWER PER MINUTE, for the chart.
//
// Its ET re-parse (`toLocaleString` with a time zone) is the expensive part, and a two-chart list flip
// asked it ~3.5 ms worth of times on a production CPU profile: `_developingBarISO` (StockChart) runs for
// the developing-bar seed of every bars snapshot of both charts (`useLegacyChartBars.resolveDailyTodaySeed`
// <- `useBarSnapshotBars`). The answer can only change when the ET DATE does, and ET midnight falls on a
// whole minute (whole-hour offsets), so within one epoch minute the answer is the same. Keyed by the clock
// the computation itself reads (`new Date()`), so a test's `vi.setSystemTime` moves it too.
//
// Here, not in `utils/marketSession.js`: that file is on the Notebook's first open and this one is not
// (only the chart imports it), so the memo costs first open nothing.
import { isTradingSessionTodayET } from '../../utils/marketSession'

let memo = { minute: NaN, value: false }

export function tradingSessionTodayET() {
  const minute = Math.floor(new Date().getTime() / 60000)
  if (minute === memo.minute) return memo.value
  const value = isTradingSessionTodayET()
  if (Number.isFinite(minute)) memo = { minute, value }
  return value
}

/** Tests only: forget the cached answer. */
export function __resetTradingTodayMemoForTests() { memo = { minute: NaN, value: false } }
