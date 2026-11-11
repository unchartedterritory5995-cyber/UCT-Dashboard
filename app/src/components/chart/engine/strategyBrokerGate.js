// ─── ⛔⛔ THE GATE ON THE STRATEGY BROKER (S1, 2026-10-05) ───────────────────────
//
// S1 emulates TradingView's broker so a strategy's PLOTS that read broker values
// (`strategy.position_size`, `strategy.position_avg_price`, ...) can be drawn. It
// ships DARK: until this flag is on, the runtime lane refuses those values by name
// exactly as before (`pine:strategy-call`), and nothing in `runtime/broker.js` runs
// for any member.
//
// ⭐ The convention is the repo's: default OFF means `=== '1'` (absent, '', '0',
// 'true' are all off), read INSIDE a function so a test can flip it, and a build
// with no `import.meta.env` fails CLOSED. A build option (`strategyBroker: true`
// on `buildRuntimeIr`) overrides it for rails and measurement only.

/** Is the build flag on? (`VITE_PINE_STRATEGY_BROKER_ENABLED === '1'`). One reader. */
export function strategyBrokerEnabled() {
  try {
    return import.meta.env.VITE_PINE_STRATEGY_BROKER_ENABLED === '1'
  } catch {
    return false
  }
}
