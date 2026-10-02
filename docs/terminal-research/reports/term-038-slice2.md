# TERM-038 slice 2: more saved things become names

Date: 2026-10-01. Branch `lane/term-038-slice2`, based on `integrate/terminal-fixes` @ `52952fef1f`.

## Starting point

The base already carried build D (2026-09-30), which the backlog row did not yet record:
saved screens (`S:` → `/screener?savedScreen=`) and AI Search conversations
(`A:` → `/ai-search?thread=`) had doors and were address kinds. This slice took the
`no-door` and `deferred` kinds that were left.

## What slice 2 built

| Kind | Prefix | Door (query param on an existing page) | Scope |
|---|---|---|---|
| Theme set | `T:` | `/charts?openThemeSet=<id>` | owner; empty while `THEME_SETS_ENABLED` is off |
| Floor post | `F:` | `/community?thread=<id>` | **viewer** (see the rule below) |

### Theme sets

- `ChartsWorkspace` gained `?openThemeSet=`, built the same way as `?openWatchlist=`. It points the board's first Themes widget at the set through that widget's own opts path. If the board has no Themes widget, it adds one carrying the set. It strips the param, and a malformed id does nothing.
- `ThemeTrackerPage` read its set from `opts` only once, at mount. Without a change there, the door would update the opts while the widget still showed Default. The page now follows an outside change of `opts.themeSetId`. When the member picks a set themselves, the new opts value already matches the state, so nothing happens.
- When the address points at another member's set, or a set that was deleted, `ThemeTrackerPage` falls back to Default. It already did this for a set deleted elsewhere.

### Floor posts: the visibility rule

A Floor post is public, so the address space cannot filter it by owner. The rule comes from code the Floor already runs; this slice adds no new rule:

- **Who can address it:** every member that the Floor's own gate `community.require_community` admits. The lister calls that function directly. The gate passes when the flag is on or the member is an admin, and then requires a paid plan or trial. It loads the user from `auth_service` with their plan.
- **What they can address:** live posts in the Floor space (`space='floor' AND deleted=0`). This is the same predicate `get_floor_thread` serves. A moderator "hide" is also a soft delete, so hidden posts drop out as well.
- **Anyone else:** gets nothing. Search returns no rows and resolve returns `None`.
- **On the Floor (TERM-056):** an `F:` address links for every reader, whoever wrote the post. A `T:` address shows as the author's private set, with no name, because theme sets have no share.

The new store helpers are `community_store.list_floor_titles()` and `floor_title(id)`.

### Flag discipline

- The backend kinds sit behind `ADDRESS_SPACE_ENABLED`, like every other kind. The routes return 404 while it is off.
- Both new page doors read `addressSpaceEnabled` from the auth payload. While it is off, the page ignores the param and leaves it in the URL. The `ThemeTrackerPage` opts sync is gated on the same flag. Unset, both pages behave as before.
- ⚠️ `docs/feature_flags.json` records `ADDRESS_SPACE_ENABLED` as **ARMED on web since 2026-09-29**. S/A (build D) and T/F (this slice) therefore go live to members with the next deploy that carries them. I updated the ledger note to name the kinds added since arming. `test_feature_flag_ledger.py` passed: 250 tests.

## Still open

- **Notebook saved views (`j2_note_saved_views`) and folders (`j2_note_folders`):** still `no-door`. Their door belongs in the Notebook editor files (`app/src/pages/journal-2-0/components/notebook/**`), which the notebook workstream owns. The EXEMPT reasons now say so.
- **Playbook entries (`upb_entries`):** `no-door`, with no URL instruction yet. This was outside this slice.
- **Re-applying a door:** each door applies once per page mount. Opening an address while already on `/charts` or `/community` does not re-apply it. `openWatchlist` behaves the same way.
- **Pre-existing red, not caused by this slice:** `src/hooks/pollingSites.rail.test.js` fails on `app/src/pages/research/tabs/OptionsChainTab.jsx`, which this branch does not touch.

## Rails

Backend: `tests/test_address_space.py` has **21** tests, 3 of them new. All use real stores:

- `test_a_theme_set_is_owner_scoped_and_dark_with_its_own_flag`
- `test_the_floor_visibility_rule_is_the_floors_own_gate`: covers a reader who did not write the post, a deleted post, an unpaid member with the trial disabled, and the Floor dark.
- `test_floor_text_links_floor_posts_and_keeps_theme_sets_private`

The stubbed-lister tests and the real-lister test also cover both new kinds now.

Frontend tests assert on rendered text and on the route reached:

- `ChartsWorkspace.test.jsx` +4: adds a widget, retargets an existing one, a dark control, and a malformed id.
- `ThemeTrackerPage.themeSetDoor.test.jsx` (2): the picker label follows the outside change and the `?set=` overlay is requested; a dark control.
- `Floor2.threadDoor.test.jsx` (3): uses the real data hooks with only `fetch` stubbed. The post's heading renders, `/api/community/floor/threads/41` is requested and the param is stripped; a dark control; a garbage id.
- `CommandPalette.saved.test.jsx` +2: the `T:` and `F:` rows render, and clicking each reaches its route.

### Commands and totals

```
python -m pytest tests/test_address_space.py -q          -> 21 passed
python -m pytest tests/test_feature_flag_ledger.py -q    -> 250 passed
(app) npx vitest run src/components/CommandPalette.saved.test.jsx src/components/CommandPalette.test.jsx
      src/floor2 src/pages/ThemeTrackerPage.themeSetDoor.test.jsx src/pages/ThemeTrackerPage.flagkey.test.jsx
      src/pages/ThemeTrackerPage.a11y.test.jsx src/pages/ThemeTrackerPage.chartmount.test.jsx
      src/pages/ThemeTrackerPage.warmtf.test.jsx src/pages/charts/widgets/ThemesWidget.test.jsx
      src/pages/charts/ChartsWorkspace.test.jsx src/lib/swallowedFetch.census.test.js
      src/pages/command/keyListenerCensus.test.js --maxWorkers=4
      -> Test Files 13 passed (13), Tests 169 passed (169)
```

### Mutations

Each mutation was applied with an editor, the tests went red, and the code was restored with an editor. The full suites were then re-run green.

1. Dropped `AND deleted=0` from `list_floor_titles`: `test_the_floor_visibility_rule...` failed because the deleted post resolved.
2. Removed `setThemeSetId(optsSetId)` from the `ThemeTrackerPage` sync: the "switches the widget to that set" test failed.
3. Made the Floor door ignore the flag: the dark-control test failed.

A fourth mutation, removing the Floor reader gate in `_floor_threads`, was refused by the session's permission classifier as a security-weakening edit, so I did not run it. The gate's behaviour is still covered by the unpaid-member and Floor-dark assertions.
