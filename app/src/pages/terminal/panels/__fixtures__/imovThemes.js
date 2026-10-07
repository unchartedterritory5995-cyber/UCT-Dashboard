// IMOV fixtures: two themes in the `/api/theme-performance` shape (holdings with `source`, per-period
// `returns`, the `_owner_syms` stash and the tracker's own `group_return`).
//
// Semiconductors, 1D: NVDA +4, AMD +2, AVGO −1, MU −3 are counted (n = 4, equal-weight +0.50%);
// INTC has no 1D return; ENGX is an engine-overlay member and must never count. The tracker's
// published 1D figure (+1.00%) deliberately differs from the plain mean.
// AI Software, 1D: NVDA +4, PLTR −6 → −1.00%, the same as its published figure.
export const SEMIS = {
  name: 'Semiconductors', ticker: 'SMH', theme_id: 'semiconductors',
  _owner_syms: ['NVDA', 'AMD', 'AVGO', 'MU', 'INTC'],
  group_return: { '1d': 1.0, '1w': 3.0 },
  holdings: [
    { sym: 'NVDA', source: 'owner', returns: { '1d': 4, '1w': 10, '1m': null, '3m': 20 } },
    { sym: 'AMD', source: 'owner', returns: { '1d': 2, '1w': -2 } },
    { sym: 'AVGO', returns: { '1d': -1, '1w': 3 } },
    { sym: 'MU', source: 'owner', returns: { '1d': -3, '1w': 1 } },
    { sym: 'INTC', source: 'owner', returns: { '1d': null, '1w': null } },
    { sym: 'ENGX', source: 'engine', returns: { '1d': 50, '1w': 50 } },
  ],
}

export const AI = {
  name: 'AI Software', ticker: 'AIQ', theme_id: 'ai_software',
  group_return: { '1d': -1.0 },
  holdings: [
    { sym: 'NVDA', source: 'owner', returns: { '1d': 4 } },
    { sym: 'PLTR', source: 'owner', returns: { '1d': -6 } },
  ],
}

export const PAYLOAD = { themes: [SEMIS, AI], status: 'ok', live_as_of: '2026-10-06T15:00:00+00:00' }
