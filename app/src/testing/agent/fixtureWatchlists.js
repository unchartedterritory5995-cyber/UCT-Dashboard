// The agent harness's FIXTURE saved watchlists (agentHarness.jsx ?watchlists=1), in one place: the harness serves them, the
// guide's routing probe (agentGuideInventory) reads their names as the member's lists, and the browser runner turns them on
// for a case whose words name one (given.mjs). Test-only.
export const FIXTURE_WATCHLISTS = [
  { id: 'm1', name: 'Momentum', syms: ['NVDA', 'TSLA', 'META', 'AAPL'], notes: { TSLA: 'earnings 10/22' } },
  { id: 's1', name: 'Swing', syms: ['MSFT'], notes: {} },
  { id: 'l1', name: 'Long Term', syms: [], notes: {} },
]
