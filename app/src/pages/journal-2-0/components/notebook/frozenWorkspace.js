// Journal Widgets — the journal host's WorkspaceContext value ("one component,
// two hosts"): workspace widgets render UNMODIFIED inside a note by mounting
// under this context instead of the /charts one.
//
// ⛔ BUILD RULE (lesson_an_embedded_chat_must_be_bounded_by_its_host + the A6
// assumption): the ENTIRE surface the real provider supplies is enumerated
// here, every member stubbed DELIBERATELY — a member accidentally falling
// through to WorkspaceContext's FALLBACK (or to undefined) is a silent dead
// end. The FALLBACK itself omits four members the real provider carries
// (widgetCanvasByType/ById, chartApiById, activeWatchlistRef), so "the
// fallback covers it" is exactly the trap. frozenWorkspace.test.js derives
// the real provider's key set from ChartsWorkspace.jsx's source and fails BY
// NAME when the workspace grows a member this file doesn't carry.
//
// The sentinel refs matter: watchlist/chart hotkey-ownership guards compare
// `activeRef.current !== myId` — a null ref would pass VACUOUSLY and an
// embedded widget would swallow the page's arrow keys / capture hotkeys
// (P2 audit finding). '__frozen-embed__' matches no widget id, ever.
export const FROZEN_OWNER = '__frozen-embed__'

/** The frozen host's context value. `symbol` pins every color group (a
 *  widget resolving its symbol from any group reads the frozen capture);
 *  everything interactive is inert — scroll/click inside an embed must never
 *  write workspace state (the read-only invariant). Build one per embed via
 *  useMemo — the refs are per-instance on purpose (two embeds must not share
 *  a chartApi registry). */
export function frozenWorkspaceValue({ symbol = null } = {}) {
  return {
    groupSyms: { A: symbol, B: symbol, C: symbol, D: symbol },
    setGroupSym: () => {},
    chartsTheme: 'default',
    widgetCanvasByType: {},
    widgetCanvasById: {},
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: FROZEN_OWNER },
    chartApiById: { current: new Map() },
    activeWatchlistRef: { current: FROZEN_OWNER },
    periodSortMode: false,
    onPeriodSelected: () => {},
    onPeriodCancel: () => {},
    replayCutoff: null,
    exitReplay: () => {},
    replayArmPick: false,
    onReplayCutoffPicked: () => {},
    onReplayPickCancel: () => {},
    startMarker: null,
    startMarkerStyle: 'line',
  }
}
