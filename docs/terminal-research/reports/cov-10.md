# COV-10 — publish a LIST to a subscribing widget; frozen vs tracking lists

Branch `lane/cov-10-lists` (from `integrate/terminal-fixes` @ `ee17bc1652`), 2026-10-01.
Roadmap row: `COV-10` (capability-matrix §COV, S4 · A12). Bloomberg: copy-from-source vs
link-to-source chosen explicitly at import. Koyfin: a polymorphic group payload.

## 1. Re-measured before building — what already existed

| Piece | State | Where |
|---|---|---|
| **Copy-or-link for saved watchlists** (TERM-077 / FB-A12-03) | ✅ **SHIPS, ARMED on web 2026-09-30** | `WATCHLIST_COPY_OR_LINK_ENABLED` (`armed`); `api/services/watchlist_origin.py` (table `watchlist_origins`, modes `copy`/`link`, states `independent`/`current`/`source_unavailable`/`paused_edited`); `POST /api/watchlists/{id}/save-as`; item routes 409 on a linked list; UI `app/src/pages/watchlist/SaveListDialog.jsx` (two choices, no default) + `ListOrigin` line on the /watchlists page; auth key `watchlist_copy_or_link_enabled` → `AuthContext.watchlistCopyOrLinkEnabled`. Rails `tests/test_watchlist_copy_or_link.py`. Sources: **only other watchlists** (community / prebuilt / own). |
| **Typed context channels** (TERM-079 / FB-S4-01) | ✅ **SHIPS, ungated** | `app/src/lib/context/contextChannels.jsx` — five kinds (`symbol`, `symbol-set`, `list-ref`, `timeframe`, `range`), per-channel store. Publisher: WatchlistWidget publishes the saved list it shows on `list-ref:<colour>` (`watchKeyToListRef`). Consumer: ScatterWidget (Market Map) follows with `opts.followList`. Nothing else read a channel. |
| **Colour groups A/B/C/D** | ✅ ships — symbol-only, exactly four | `WorkspaceContext.groupSyms` / `groupTfs`. Unchanged by this lane. |
| **Scanner widget** | ✅ ships — but published **nothing** | `ScannerWidget` → `ScannerResults` polls `/api/scans/<preset>` every 30s; only its row clicks reached the group (as a symbol). |
| **A widget subscribing to another widget's LIST, frozen or tracking** | ❌ **ABSENT** | No widget on /charts could take a list from a non-watchlist source, and nothing on /charts distinguished a frozen list from a tracking one. A following Market Map would have plotted an **empty** universe for any list-ref it could not resolve. |

## 2. What this lane built (dark)

The smallest missing piece: the **next source** after watchlists — a Scanner widget's live
scan — published to a **subscribing Watchlist widget**, with the frozen/tracking choice made
explicitly at import and shown on the widget. It extends TERM-077's rule (no default mode,
never silently change mode) to the /charts board rather than rebuilding it.

- **Publish** — `ScannerResults.jsx` publishes `list-ref {source:'scan', value:<scanKey>, label:<scanName>}` on its colour group's channel, and clears it on unmount.
- **Offer** — a same-group `WatchlistWidget` with **no list picked** shows, above its picker:
  *"Group A is showing the scan **Top Gainers (30-Day)**. Use it in this list as:"* with two
  buttons, **Track it** / **Freeze a copy**. Nothing is subscribed until one is pressed. The
  channel is read only while the picker shows, so a publish never re-renders a widget that
  already shows a list (the H14/PERF-4 rule of `contextChannels.jsx`).
- **FROZEN** — reads the scan once, stores `{mode:'freeze', source, value, label, at, asOf, symbols}` in the widget's own opts (persisted with the layout), never reads the source again.
  Line: *"FROZEN · Frozen copy of X · taken Oct 1, 2:14 PM ET · 2 stocks · does not update"*.
  An unreadable source (HTTP / network / not a list) or a source holding nothing is **refused
  by name — "Nothing was saved."** — never frozen as an empty list.
- **TRACKING** — stores no members; re-resolves `/api/scans/<key>` every 30s (`useMobileSWR`,
  tuple key so a failure is an *error*, not `null` data shared with ScannerResults' cache).
  - live: *"Tracking X · live · N stocks · read <time> ET"*; a source that answers nothing:
    *"… · live · the source holds no stocks right now"* (said in words).
  - **never readable** (HTTP error, unknown scan key): *"SOURCE UNAVAILABLE: <why>. Nothing is
    shown because nothing could be read; this is not an empty list."* — and **no table**.
  - **stopped being readable**: keeps the last members and says *"SOURCE UNREADABLE (HTTP 502)
    · showing the 2 stocks last read <time>"*.
- **Market Map guard** — `ScatterWidget` follows only the list-ref sources `/api/scatter/data`
  resolves (`MAP_PLOTTABLE_LIST_SOURCES` = flagged / watchlist / tag). A scan ref is refused by
  name (*"Can't plot Top Gainers (30-Day)"*) and the map keeps its own universe.
- **One endpoint map** — `SCAN_ENDPOINTS` moved to `widgets/scanEndpoints.js`, read by both
  ScannerResults and the tracking resolver (`ListSubscription.jsx` `SOURCE_RESOLVERS`, where the
  next source kinds plug in; a kind with no resolver is "unavailable", by name).

### Flag

`CHARTS_LIST_SUBSCRIBE_ENABLED` — **new, `pending`** in `docs/feature_flags.json` (TERM-077's
flag did not fit: it is armed in prod and gates server routes for saved lists; reusing it would
have shipped this live on merge). Client-only: `api/routers/auth.py`
`charts_list_subscribe_enabled()` (read per call) puts `charts_list_subscribe_enabled: true` on
the auth payload **only when on**; `AuthContext.chartsListSubscribeEnabled` → `ChartsWorkspace`
→ `WorkspaceContext.listSubscribeEnabled` (fallback `false`). Widgets read the board, never auth.
Off: the scanner publishes nothing, no offer renders, a saved `listSub` is ignored (kept in opts),
the auth payload is byte-identical. Arm: `railway variables --service web --set CHARTS_LIST_SUBSCRIBE_ENABLED=1` (owner).

No new route, no new table, no new bare `useSWR` poll (the tracking read uses `useMobileSWR`, so
`pollingSites.rail.test.js` needs no row).

## 3. Files

- `api/routers/auth.py` — `charts_list_subscribe_enabled`, `_charts_list_subscribe_flag`
- `app/src/context/AuthContext.jsx` — `chartsListSubscribeEnabled`
- `app/src/pages/charts/ChartsWorkspace.jsx`, `WorkspaceContext.jsx` — `listSubscribeEnabled`
- `app/src/pages/charts/widgets/ListSubscription.jsx` + `.module.css` — offer, subscribed list, `trackState`, `subscriptionLine`
- `app/src/pages/charts/widgets/WatchlistWidget.jsx` — offer + subscribed render
- `app/src/pages/charts/widgets/ScannerResults.jsx` — publish; `scanEndpoints.js` — the map
- `app/src/pages/charts/widgets/ScatterWidget.jsx` — scan refs refused by name
- Rails: `app/src/pages/charts/widgets/WatchlistWidget.subscribe.test.jsx` (20), one case in `ScatterWidget.linkedList.test.jsx`, `tests/test_charts_list_subscribe_flag.py` (5)

## 4. Test runs (totals lines, read in full)

- `npx vitest run src/pages/charts/ --maxWorkers=2` → **Test Files 106 passed (106) · Tests 1150 passed (1150)**
- `npx vitest run src/hooks/pollingSites.rail.test.js` → **4 passed** (in a run with `src/lib/context/` + `src/context/`: 93 passed, 2 failed — both pre-existing and outside this lane: `symbolLinkChannels.test.js` flags `testing/panes/paneHarness.jsx` (commit `20c58838c2`, not touched here) and `focusDivergence.test.jsx` M-7 timed out at 15s walking `src/`)
- `python -m pytest tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py tests/test_charts_list_subscribe_flag.py tests/test_watchlist_copy_or_link.py -q` → **285 passed**

## 5. Mutation proofs (broken with an editor, red seen, restored with an editor; `git diff` empty after)

| # | Mutation | Red |
|---|---|---|
| 1 | `trackState`: a failed read with no data → `{kind:'live'}` (the silent-empty bug) | "a source that was NEVER readable says so…", "a failure with nothing ever read is unavailable…" |
| 2 | `ScatterWidget`: `linkedPlottable = !!linked` (follow any ref) | "COV-10: a SCAN list-ref on the group is refused BY NAME…" |
| 3 | `ScannerResults`: `listSubOn = true` (ignore the flag) | "the scanner publishes nothing and the watchlist offers nothing" |
| 4 | `SubscribeOffer`: drop the empty-symbols refusal | "a source holding nothing is not frozen either" |
| 5 | `WatchlistWidget`: honour `opts.listSub` while dark | "a saved subscription is IGNORED while off…" |
| 6 | `auth.py`: always emit the key | 3 of 5 in `test_charts_list_subscribe_flag.py` |

## 6. Open

- ~~**More sources**: theme holdings, saved screens.~~ Done in the follow-up lane, §7. Community lists on /charts remain (TERM-077's Save to My Lists covers them on the Watchlists surface).
- **Watchlist → Watchlist on /charts** still goes through TERM-077's Save to My Lists (copy/link) on the /watchlists surface; the board offer deliberately covers only sources a Watchlist widget cannot already pick.
- **Four groups, symbol-only colour groups**: unchanged (the `list-ref` channel key is already open-ended; the colour-group UI is not).
- **Frozen → tracking conversion**: not offered, by TERM-077's rule (a list never changes mode); leave and re-subscribe.
- **Arming** is an owner call; not browser-verified in a live board yet (unit rails only).
- **A theme set's edits are not the source.** The Themes widget can show a member's theme SET
  (per-theme added/removed stocks); the published source is the taxonomy theme's holdings from
  `theme_db`, not the set's edited version. The offer names the theme, not the set.

## 7. Follow-ups (branch `lane/cov-06-10-followups`, from `integrate/terminal-fixes` @ `c5b4091188`)

Two more list sources, still dark behind `CHARTS_LIST_SUBSCRIBE_ENABLED`. The flag now also gates
two routes (`api/routers/charts_list_sources.py`, plain `def`, 404 while unset), which answer the
scan endpoints' shape `{results:[{sym}], as_of, label, total}`, so `readSource` has one parser:

- **Theme holdings.** `GET /api/charts/list-sources/theme/{theme_id}` reads ONLY through
  `theme_db`: `get_theme_holdings` (owner rows, engine `add` rows merged where the owner has none;
  an engine re-tier never duplicates or overrides an owner row) plus a new read function
  `theme_db.get_theme`. That one exists because `get_theme_holdings` answers `[]` for an unknown
  id, which would render as "the source holds no stocks". Publisher: `ThemesWidget` publishes the
  OPEN taxonomy theme (`ThemeTrackerPage` reports it through a new `onOpenThemeChange` prop,
  passed only while the flag is on) and clears the channel when no theme, or a custom theme, is
  open. Offer: "Group A is showing the theme **Quantum Computing**"; tracking line says
  "current holdings", not "live".
- **Saved screen (nightly results).** `GET /api/charts/list-sources/screen/{id}` runs one of MY
  saved screens (`saved_screens.get`, owner-scoped, 402 for a free plan) through
  `query.run_scan` on the nightly snapshot, one page of 500, symbols in board form (BRK.B →
  BRK-B). No widget on the board shows a saved screen, so the empty Watchlist widget offers it
  itself: one collapsed button ("Track or freeze one of my saved screens…") that reads
  `/api/screener/saved-screens` only when pressed, then a picker, then the same two-button offer.
  The tracking line says "nightly results". A screen that matched more than one page says so:
  "2 stocks (the first 2 of 812)", on the tracking line and on a frozen copy (`total` is stored).
- **Never a silent empty list**, extended: a gone theme or screen is 404 WITH its reason, and
  `readSource` now carries the server's `detail`, so the member reads "SOURCE UNAVAILABLE: it
  could not be read (HTTP 404 · That saved screen no longer exists)" and no table. A screen whose
  spec no longer runs is a 400 with the scanner's reason. A screens list that cannot be read says
  why ("Saved screens need a paid plan." / "… could not be read (HTTP 500)."), never "no screens".
- The Market Map's guard already refuses any list-ref outside `flagged/watchlist/tag` by name, so
  a theme ref is refused the same way a scan ref is.

Tests: `tests/test_charts_list_sources.py` (6, real stores: the sandbox auth.db, a snapshot seeded
through `snapshot_db.upsert_rows`, the engine overlay written through `theme_engine.store.upsert_add`),
`WatchlistWidget.sources.test.jsx` (10), `ThemeTrackerPage.openThemeReport.test.jsx` (2, the real
page). Totals are in cov-06.md §6 (same run): pytest 388 passed / 1 failed (the integrator's
`artifact_versions` EXEMPT line); charts 1166/1166; other suites 595/595.

Mutations (editor in, run, editor out):

| # | Mutation | Red |
|---|---|---|
| F2 | theme route skips the existence check | `test_an_unknown_theme_is_404_never_an_empty_list` |
| F6 | `ThemesWidget` publishes while dark | `dark: neither source exists on the board` |
| F7 | `countText` drops "the first N of TOTAL" | `Freeze stores the nightly members and says when a page cut the list short` |
| F8 | `ThemeTrackerPage` reports a theme with no taxonomy id (falls back to its ticker) | `a theme with no taxonomy id (or a custom one) reports null` |
