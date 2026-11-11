// How often a screen on view asks its scan again during the regular session (`useScreenerScan`'s
// `refreshMs`). Its own module so a test that mocks `useScreenerScan` (most screen tests do) does not
// also have to restate this constant.
// ⛔ The server recomputes the live overlay about once a minute (a sweep takes 20-60 s on production,
// measured 2026-11-10), so a shorter interval buys nothing and costs a scan query per member per tick.
export const LIVE_REFRESH_MS = 15_000
